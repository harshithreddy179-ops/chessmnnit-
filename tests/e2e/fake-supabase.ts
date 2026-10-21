import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { Pool, types, type QueryResult } from "pg";

/**
 * A local stand-in for the two Supabase services this app talks to, backed by the REAL
 * migrated PostgreSQL schema:
 *
 *   PostgREST  /rest/v1/<table>, /rest/v1/rpc/<fn>   -> executed as anon / authenticated /
 *                                                        service_role with real RLS + triggers
 *   GoTrue     /auth/v1/user, token refresh, admin users
 *
 * It exists so the browser tests can drive the complete application (Next.js server, API
 * routes, supabase-js, RLS) without a Supabase project. It is NOT Supabase: it implements only
 * the subset of the REST dialect the app uses, accepts unsigned test JWTs, and has no Realtime.
 */
types.setTypeParser(20, (v) => Number(v)); // int8 -> number (as PostgREST does)
types.setTypeParser(1700, (v) => Number(v)); // numeric -> number

export interface FakeSupabaseOptions {
  pool: Pool;
  port: number;
  publishableKey: string;
  secretKey: string;
}

const IDENT = /^[a-z_][a-z0-9_]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super("http error");
  }
}

interface FnMeta {
  retset: boolean;
  isVoid: boolean;
  args: { name: string; type: string }[];
}

export function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

/** Unsigned JWT-shaped token. The stand-in trusts it; the real app never sees the difference. */
export function makeAccessToken(userId: string, email: string): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ sub: userId, email, role: "authenticated", aud: "authenticated", iat: now, exp: now + 3600 }));
  return `${header}.${payload}.${b64url(createHash("sha256").update(userId).digest())}`;
}

/** Value for the `sb-<ref>-auth-token` cookie that @supabase/ssr reads. */
export function sessionCookieValue(userId: string, email: string): string {
  const session = {
    access_token: makeAccessToken(userId, email),
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: `refresh-${userId}`,
    user: { id: userId, aud: "authenticated", role: "authenticated", email },
  };
  return `base64-${b64url(JSON.stringify(session))}`;
}

type Actor = { role: "anon" | "authenticated" | "service_role"; sub: string | null };
type Q = (sql: string, params?: unknown[]) => Promise<QueryResult>;
interface Reply {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

const err = (status: number, code: string, message: string, details: string | null = null) =>
  new HttpError(status, { code, message, details, hint: null });

export async function startFakeSupabase(opts: FakeSupabaseOptions) {
  const { pool } = opts;
  const tableCols = new Map<string, Map<string, string>>(); // table -> column -> data_type

  // node-pg cannot parse arrays of user-defined enums (it returns the raw "{a,b}" text), whereas
  // PostgREST returns proper JSON arrays. Enum labels in this schema are plain identifiers.
  const enumArrays = await pool.query("select t.oid::int as oid from pg_type t join pg_type e on e.oid = t.typelem where t.typcategory = 'A' and e.typtype = 'e'");
  for (const { oid } of enumArrays.rows as { oid: number }[]) {
    types.setTypeParser(oid, (v: string) => (v === "{}" ? [] : v.slice(1, -1).split(",")));
  }
  const fns = new Map<string, FnMeta>();

  const cols = await pool.query(
    `select table_name, column_name, data_type from information_schema.columns where table_schema = 'public'`,
  );
  for (const r of cols.rows) {
    if (!tableCols.has(r.table_name)) tableCols.set(r.table_name, new Map());
    tableCols.get(r.table_name)!.set(r.column_name, r.data_type);
  }
  const procs = await pool.query(`
    select p.proname, p.proretset, p.prorettype::regtype::text as rettype, p.proargnames, p.proargmodes::text[] as modes,
           (select array_agg(format_type(t, null) order by ord)
              from unnest(coalesce(p.proallargtypes, p.proargtypes::oid[])) with ordinality as u(t, ord)) as types
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'`);
  for (const r of procs.rows) {
    const args: FnMeta["args"] = [];
    ((r.types ?? []) as string[]).forEach((type, i) => {
      const mode = r.modes?.[i] ?? "i";
      if (mode === "i" || mode === "b" || mode === "v") args.push({ name: r.proargnames[i], type });
    });
    fns.set(r.proname, { retset: r.proretset, isVoid: r.rettype === "void", args });
  }

  // ------------------------------------------------------------------ identity
  const authenticate = async (req: IncomingMessage): Promise<Actor> => {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (token === opts.secretKey || req.headers.apikey === opts.secretKey) return { role: "service_role", sub: null };
    if (!token || token === opts.publishableKey) return { role: "anon", sub: null };
    try {
      const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString());
      if (typeof payload.sub === "string" && UUID.test(payload.sub) && payload.exp > Date.now() / 1000) {
        const u = await pool.query("select 1 from auth.users where id = $1", [payload.sub]);
        if (u.rowCount) return { role: "authenticated", sub: payload.sub };
      }
    } catch {
      // fall through to 401
    }
    throw err(401, "PGRST301", "JWT invalid or expired");
  };

  const withActor = async <T,>(actor: Actor, fn: (q: Q) => Promise<T>): Promise<T> => {
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query(`set local role ${actor.role}`);
      await c.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ role: actor.role, ...(actor.sub ? { sub: actor.sub } : {}) }),
      ]);
      const out = await fn((sql, params) => c.query(sql, params as unknown[]));
      await c.query("commit");
      return out;
    } catch (error) {
      await c.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      c.release();
    }
  };

  // ------------------------------------------------------------- query parsing
  const ident = (s: string) => {
    if (!IDENT.test(s)) throw err(400, "PGRST100", `invalid identifier ${s}`);
    return `"${s}"`;
  };

  const splitTop = (input: string): string[] => {
    const parts: string[] = [];
    let depth = 0;
    let quote = false;
    let cur = "";
    for (const ch of input) {
      if (ch === '"') quote = !quote;
      if (!quote && ch === "(") depth++;
      if (!quote && ch === ")") depth--;
      if (!quote && depth === 0 && ch === ",") {
        parts.push(cur);
        cur = "";
      } else cur += ch;
    }
    if (cur) parts.push(cur);
    return parts;
  };

  const unquote = (v: string) => (v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1).replaceAll('\\"', '"') : v);

  function condition(col: string, rest: string, params: unknown[]): string {
    let negate = false;
    let spec = rest;
    if (spec.startsWith("not.")) {
      negate = true;
      spec = spec.slice(4);
    }
    const dot = spec.indexOf(".");
    const op = spec.slice(0, dot);
    const raw = spec.slice(dot + 1);
    const c = ident(col);
    const push = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    let sql: string;
    switch (op) {
      case "eq": sql = `${c} = ${push(unquote(raw))}`; break;
      case "neq": sql = `${c} <> ${push(unquote(raw))}`; break;
      case "gt": sql = `${c} > ${push(unquote(raw))}`; break;
      case "gte": sql = `${c} >= ${push(unquote(raw))}`; break;
      case "lt": sql = `${c} < ${push(unquote(raw))}`; break;
      case "lte": sql = `${c} <= ${push(unquote(raw))}`; break;
      case "like": sql = `${c} like ${push(raw.replaceAll("*", "%"))}`; break;
      case "ilike": sql = `${c} ilike ${push(raw.replaceAll("*", "%"))}`; break;
      case "is": sql = raw === "null" ? `${c} is null` : raw === "true" ? `${c} is true` : `${c} is false`; break;
      case "in": sql = `${c} = any(${push(splitTop(raw.slice(1, -1)).map(unquote))})`; break;
      default: throw err(400, "PGRST100", `unsupported operator ${op}`);
    }
    return negate ? `not (${sql})` : sql;
  }

  function logic(expr: string, params: unknown[], joiner: "and" | "or"): string {
    const inner = expr.startsWith("(") && expr.endsWith(")") ? expr.slice(1, -1) : expr;
    return splitTop(inner)
      .map((part) => {
        const m = part.match(/^(and|or)\((.*)\)$/s);
        if (m) return `(${logic(`(${m[2]})`, params, m[1] as "and" | "or")})`;
        const d = part.indexOf(".");
        return condition(part.slice(0, d), part.slice(d + 1), params);
      })
      .join(` ${joiner} `);
  }

  function where(sp: URLSearchParams, params: unknown[]): string {
    const clauses: string[] = [];
    for (const [key, value] of sp.entries()) {
      if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(key)) continue;
      if (key === "or" || key === "and") clauses.push(`(${logic(value, params, key)})`);
      else clauses.push(condition(key, value, params));
    }
    return clauses.length ? ` where ${clauses.join(" and ")}` : "";
  }

  const selectList = (sp: URLSearchParams) => {
    const s = sp.get("select");
    if (!s || s === "*") return "*";
    return splitTop(s).map((c) => ident(c.trim())).join(", ");
  };

  const orderBy = (sp: URLSearchParams) => {
    const o = sp.get("order");
    if (!o) return "";
    const terms = o.split(",").map((term) => {
      const [col, ...mods] = term.split(".");
      const nulls = mods.includes("nullsfirst") ? " nulls first" : mods.includes("nullslast") ? " nulls last" : "";
      return `${ident(col!)} ${mods.includes("desc") ? "desc" : "asc"}${nulls}`;
    });
    return ` order by ${terms.join(", ")}`;
  };

  const coerce = (table: string, col: string, value: unknown) => {
    const type = tableCols.get(table)?.get(col);
    if (value !== null && typeof value === "object" && (type === "jsonb" || type === "json")) return JSON.stringify(value);
    return value;
  };

  const oneRow = (rows: unknown[]) => {
    if (rows.length !== 1) {
      throw err(406, "PGRST116", "JSON object requested, multiple (or no) rows returned", `The result contains ${rows.length} rows`);
    }
    return rows[0];
  };

  // --------------------------------------------------------------------- REST
  async function rpc(name: string, body: unknown, actor: Actor): Promise<Reply> {
    const meta = fns.get(name);
    if (!meta || !IDENT.test(name)) throw err(404, "PGRST202", `Could not find the function public.${name}`);
    const params: unknown[] = [];
    const named: string[] = [];
    for (const [k, v] of Object.entries((body ?? {}) as Record<string, unknown>)) {
      const a = meta.args.find((x) => x.name === k);
      if (!a) throw err(404, "PGRST202", `Could not find the function public.${name} with argument ${k}`);
      params.push(a.type === "jsonb" || a.type === "json" ? JSON.stringify(v) : v);
      named.push(`${ident(k)} => $${params.length}::${a.type}`);
    }
    const res = await withActor(actor, (q) => q(`select * from public.${name}(${named.join(", ")})`, params));
    if (meta.isVoid) return { status: 204, body: undefined };
    if (meta.retset) return { status: 200, body: res.rows };
    const scalar = res.fields.length === 1 && res.fields[0]!.name === name;
    return { status: 200, body: scalar ? (res.rows[0]?.[name] ?? null) : res.rows[0] };
  }

  async function rest(req: IncomingMessage, url: URL, body: unknown, actor: Actor): Promise<Reply> {
    const path = url.pathname.replace(/^\/rest\/v1\//, "");
    if (path.startsWith("rpc/")) return rpc(path.slice(4), body, actor);

    const prefer = String(req.headers.prefer ?? "");
    const wantsRows = prefer.includes("return=representation");
    const wantsObject = String(req.headers.accept ?? "").includes("vnd.pgrst.object");
    const wantsCount = prefer.includes("count=exact");
    const table = path;
    if (!tableCols.has(table)) throw err(404, "42P01", `relation "public.${table}" does not exist`);
    const t = ident(table);
    const method = req.method ?? "GET";
    const sp = url.searchParams;

    if (method === "GET" || method === "HEAD") {
      const params: unknown[] = [];
      const w = where(sp, params);
      const limit = sp.get("limit");
      const offset = sp.get("offset");
      const tail = `${orderBy(sp)}${limit ? ` limit ${Number(limit) | 0}` : ""}${offset ? ` offset ${Number(offset) | 0}` : ""}`;
      return withActor(actor, async (q) => {
        const headers: Record<string, string> = {};
        let total: number | undefined;
        if (wantsCount || method === "HEAD") {
          total = Number((await q(`select count(*) as n from public.${t}${w}`, params)).rows[0].n);
          headers["Content-Range"] = `${offset ?? 0}-${Math.max(0, Number(offset ?? 0) + Number(limit ?? total) - 1)}/${total}`;
        }
        if (method === "HEAD") return { status: 200, body: undefined, headers: { "Content-Range": `*/${total}` } };
        const res = await q(`select ${selectList(sp)} from public.${t}${w}${tail}`, params);
        return { status: 200, body: wantsObject ? oneRow(res.rows) : res.rows, headers };
      });
    }

    if (method === "POST") {
      const rows = (Array.isArray(body) ? body : [body]) as Record<string, unknown>[];
      const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
      const params: unknown[] = [];
      const values = rows
        .map((r) => `(${keys.map((k) => { params.push(coerce(table, k, r[k] ?? null)); return `$${params.length}`; }).join(", ")})`)
        .join(", ");
      let conflict = "";
      if (prefer.includes("resolution=merge-duplicates") && sp.get("on_conflict")) {
        const target = sp.get("on_conflict")!.split(",").map(ident).join(", ");
        conflict = ` on conflict (${target}) do update set ${keys.map((k) => `${ident(k)} = excluded.${ident(k)}`).join(", ")}`;
      }
      const sql = `insert into public.${t} (${keys.map(ident).join(", ")}) values ${values}${conflict}${wantsRows ? ` returning ${selectList(sp)}` : ""}`;
      const res = await withActor(actor, (q) => q(sql, params));
      if (!wantsRows) return { status: 201, body: undefined };
      return { status: 201, body: wantsObject ? oneRow(res.rows) : res.rows };
    }

    if (method === "PATCH") {
      const params: unknown[] = [];
      const sets = Object.entries(body as Record<string, unknown>).map(([k, v]) => {
        params.push(coerce(table, k, v));
        return `${ident(k)} = $${params.length}`;
      });
      const w = where(sp, params);
      const res = await withActor(actor, (q) => q(`update public.${t} set ${sets.join(", ")}${w}${wantsRows ? ` returning ${selectList(sp)}` : ""}`, params));
      if (!wantsRows) return { status: 204, body: undefined };
      return { status: 200, body: wantsObject ? oneRow(res.rows) : res.rows };
    }

    if (method === "DELETE") {
      const params: unknown[] = [];
      const w = where(sp, params);
      const res = await withActor(actor, (q) => q(`delete from public.${t}${w}${wantsRows ? ` returning ${selectList(sp)}` : ""}`, params));
      return wantsRows ? { status: 200, body: res.rows } : { status: 204, body: undefined };
    }
    throw err(405, "PGRST105", "method not allowed");
  }

  // --------------------------------------------------------------------- Auth
  async function userJson(id: string) {
    const r = await pool.query("select id, email, email_confirmed_at, raw_user_meta_data, created_at, banned_until from auth.users where id = $1", [id]);
    const u = r.rows[0];
    if (!u) throw new HttpError(404, { code: 404, error_code: "user_not_found", msg: "User not found" });
    return {
      id: u.id, aud: "authenticated", role: "authenticated", email: u.email, email_confirmed_at: u.email_confirmed_at, phone: "",
      confirmed_at: u.email_confirmed_at, last_sign_in_at: new Date().toISOString(), app_metadata: { provider: "google", providers: ["google"] },
      user_metadata: u.raw_user_meta_data, identities: [], created_at: u.created_at, updated_at: u.created_at, banned_until: u.banned_until,
    };
  }

  async function auth(req: IncomingMessage, url: URL, body: unknown, actor: Actor | null): Promise<Reply> {
    const path = url.pathname.replace(/^\/auth\/v1/, "");
    if (req.method === "GET" && path === "/user") {
      if (!actor?.sub) throw new HttpError(401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
      const ban = await pool.query("select banned_until from auth.users where id = $1", [actor.sub]);
      if (ban.rows[0]?.banned_until && new Date(ban.rows[0].banned_until) > new Date()) {
        throw new HttpError(403, { code: 403, error_code: "user_banned", msg: "User is banned" });
      }
      return { status: 200, body: await userJson(actor.sub) };
    }
    if (req.method === "POST" && path === "/token") {
      const refresh = String((body as { refresh_token?: string })?.refresh_token ?? "");
      const id = refresh.replace(/^refresh-/, "");
      if (!UUID.test(id)) throw new HttpError(400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" });
      const user = await userJson(id);
      return { status: 200, body: { access_token: makeAccessToken(id, user.email), token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: refresh, user } };
    }
    if (req.method === "POST" && path === "/logout") return { status: 204, body: undefined };

    const admin = path.match(/^\/admin\/users\/([^/]+)$/);
    if (admin) {
      if (actor?.role !== "service_role") throw new HttpError(403, { code: 403, error_code: "not_admin", msg: "User not allowed" });
      const id = admin[1]!;
      if (!UUID.test(id)) throw new HttpError(400, { code: 400, error_code: "validation_failed", msg: "bad id" });
      if (req.method === "GET") return { status: 200, body: await userJson(id) };
      if (req.method === "DELETE") {
        await userJson(id);
        await pool.query("delete from auth.users where id = $1", [id]);
        return { status: 200, body: {} };
      }
      if (req.method === "PUT") {
        const ban = (body as { ban_duration?: string })?.ban_duration;
        if (ban) await pool.query("update auth.users set banned_until = case when $1 = 'none' then null else now() + interval '100 years' end where id = $2", [ban, id]);
        return { status: 200, body: await userJson(id) };
      }
    }
    throw new HttpError(404, { code: 404, error_code: "not_found", msg: `unsupported auth route ${req.method} ${path}` });
  }

  // ------------------------------------------------------------------- server
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const origin = req.headers.origin ?? "*";
    const cors = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, prefer, range, accept, accept-profile, content-profile, x-supabase-api-version",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, HEAD, OPTIONS",
      "Access-Control-Expose-Headers": "content-range",
      Vary: "Origin",
    };
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      return res.end();
    }

    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString();
    let body: unknown;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      body = undefined;
    }
    const url = new URL(req.url ?? "/", "http://x");

    const send = (status: number, payload: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { ...cors, "Content-Type": "application/json", ...headers });
      res.end(payload === undefined ? undefined : JSON.stringify(payload));
    };
    try {
      if (url.pathname.startsWith("/rest/v1/")) {
        const r = await rest(req, url, body, await authenticate(req));
        return send(r.status, r.body, r.headers);
      }
      if (url.pathname.startsWith("/auth/v1/")) {
        const actor = await authenticate(req).catch(() => null);
        const r = await auth(req, url, body, actor);
        return send(r.status, r.body);
      }
      // Realtime is intentionally not emulated: the app must degrade gracefully without it.
      return send(404, { message: "not emulated" });
    } catch (error) {
      if (error instanceof HttpError) return send(error.status, error.body);
      const e = error as { code?: string; message?: string; detail?: string; hint?: string };
      const status = e.code === "42501" ? 403 : e.code === "23505" || e.code === "23503" ? 409 : e.code === "P0002" ? 404 : 400;
      return send(status, { code: e.code ?? "XX000", message: e.message ?? "error", details: e.detail ?? null, hint: e.hint ?? null });
    }
  });

  await new Promise<void>((resolve) => server.listen(opts.port, "127.0.0.1", resolve));
  return {
    url: `http://localhost:${opts.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
