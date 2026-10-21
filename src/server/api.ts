import "server-only";

import { ZodError, type ZodType } from "zod";
import type { NextRequest } from "next/server";
import { getAppContext, type AppContext } from "@/server/auth";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface PgLikeError {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

/**
 * Translates a Postgres / PostgREST error into an API error. The database raises business
 * errors as "machine_code: human message" (SQLSTATE P0001), which we split here so the UI
 * can show the human part and branch on the code.
 */
export function mapDatabaseError(error: PgLikeError): ApiError {
  const raw = error.message ?? "Request failed";
  const sep = raw.indexOf(":");
  const looksCoded = sep > 0 && /^[a-z_]+$/.test(raw.slice(0, sep));
  const code = looksCoded ? raw.slice(0, sep) : undefined;
  const human = looksCoded ? raw.slice(sep + 1).trim() || raw.slice(0, sep).replaceAll("_", " ") : raw.replaceAll("_", " ");

  switch (error.code) {
    case "42501":
      return new ApiError(403, code ?? "forbidden", "You are not allowed to do that.");
    case "28000":
      return new ApiError(401, "unauthenticated", "Please sign in again.");
    case "53400":
      return new ApiError(429, "rate_limited", human.startsWith("rate limited") ? "You are doing that too often. Please wait a while and try again." : human);
    case "P0002":
      return new ApiError(404, "not_found", "That item could not be found.");
    case "22023":
    case "22P02":
    case "23514":
      return new ApiError(400, code ?? "invalid_input", looksCoded ? human : "Some of the information is not valid.");
    case "23505":
      return new ApiError(409, code ?? "conflict", looksCoded ? human : "That conflicts with something that already exists.");
    case "23503":
      return new ApiError(400, "invalid_reference", "That refers to something that does not exist.");
    case "P0001":
      return new ApiError(409, code ?? "rejected", human);
    default:
      // PostgREST reports "permission denied" and RLS violations without always carrying a SQLSTATE we map.
      if (/permission denied|row-level security|violates row-level/i.test(raw)) {
        return new ApiError(403, "forbidden", "You are not allowed to do that.");
      }
      return new ApiError(500, "internal_error", "Something went wrong on our side. Please try again.");
  }
}

/** Throws the mapped error if a Supabase response carried one. */
export function unwrap<T>(result: { data: T | null; error: PgLikeError | null }): T {
  if (result.error) throw mapDatabaseError(result.error);
  return result.data as T;
}

export function assertSameOrigin(req: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    throw new ApiError(403, "cross_site", "Cross-site requests are not allowed.");
  }
  const origin = req.headers.get("origin");
  if (origin) {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    if (!host || originHost !== host) throw new ApiError(403, "cross_site", "Cross-site requests are not allowed.");
  }
}

const MAX_BODY_BYTES = 32 * 1024;

export async function readJson<T>(req: Request, schema: ZodType<T>): Promise<T> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) throw new ApiError(413, "too_large", "That request is too large.");
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new ApiError(413, "too_large", "That request is too large.");
  let value: unknown = {};
  if (text.trim()) {
    try {
      value = JSON.parse(text);
    } catch {
      throw new ApiError(400, "invalid_json", "The request body was not valid JSON.");
    }
  }
  return schema.parse(value);
}

export function ok<T>(data: T, status = 200): Response {
  return Response.json({ ok: true, data }, { status, headers: { "Cache-Control": "no-store" } });
}

export function fail(error: ApiError, extra?: Record<string, unknown>): Response {
  return Response.json(
    { ok: false, error: { code: error.code, message: error.message, ...extra } },
    { status: error.status, headers: { "Cache-Control": "no-store" } },
  );
}

type Params = Record<string, string>;
interface HandlerContext<TBody> {
  req: NextRequest;
  body: TBody;
  ctx: AppContext;
  params: Params;
}
interface RouteOptions<TBody> {
  /** Request body schema. Omit for routes that take no body. */
  schema?: ZodType<TBody>;
  /** Require a finished onboarding (default true). Onboarding itself sets this to false. */
  requireOnboarded?: boolean;
}

/**
 * Wraps a mutating route handler with the checks every sensitive route needs, in order:
 * same-origin → authentication → body validation (Zod) → business logic → error mapping.
 * Authorisation beyond "signed in" is enforced by RLS / the database function being called.
 */
export function apiRoute<TBody = undefined>(
  options: RouteOptions<TBody>,
  handler: (c: HandlerContext<TBody>) => Promise<unknown>,
) {
  return async (req: NextRequest, routeCtx: { params: Promise<Params> }): Promise<Response> => {
    try {
      assertSameOrigin(req);
      const ctx = await getAppContext();
      if (!ctx) throw new ApiError(401, "unauthenticated", "Please sign in.");
      if (options.requireOnboarded && !ctx.profile.onboarding_completed_at) {
        throw new ApiError(403, "onboarding_required", "Finish onboarding first.");
      }
      const body = (options.schema ? await readJson(req, options.schema) : undefined) as TBody;
      const params = await routeCtx.params;
      const data = await handler({ req, body, ctx, params });
      return data instanceof Response ? data : ok(data ?? { done: true });
    } catch (error) {
      if (error instanceof ApiError) return fail(error);
      if (error instanceof ZodError) {
        return fail(new ApiError(400, "invalid_input", "Some of the information is not valid."), {
          fields: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        });
      }
      // Never echo internals (or secrets) to the client; log a trimmed message server-side.
      console.error("[api] unexpected error:", error instanceof Error ? error.message : "unknown");
      return fail(new ApiError(500, "internal_error", "Something went wrong on our side. Please try again."));
    }
  };
}
