import type { ZodType } from "zod";
import {
  ChessComArchiveIndexSchema,
  ChessComMonthlyArchiveSchema,
  ChessComProfileSchema,
  ChessComStatsSchema,
  type ChessComProfile,
  type ChessComStats,
} from "@/lib/chess/schemas";
import { isValidChessUsername, normalizeChessUsername } from "@/lib/chess/username";

export type ChessComErrorKind =
  | "not_found" // 404: no such player / no data for the month
  | "gone" // 410: will never have data; do not retry
  | "moved" // 301: the player was renamed; identity must be re-reviewed by a human
  | "rate_limited" // 429 persisted after retries
  | "server_error" // 5xx persisted after retries
  | "timeout"
  | "network"
  | "invalid_response"
  | "client_error";

export class ChessComError extends Error {
  constructor(
    readonly kind: ChessComErrorKind,
    message: string,
    readonly status?: number,
    /** How long Chess.com asked us to wait (429), so callers can stop a whole run early. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "ChessComError";
  }
}

export interface ChessComClientOptions {
  /** Identifies this application (and a contact) to Chess.com, as their API guidance asks. */
  userAgent: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** Strictly serial requests, at least this far apart. Parallel requests trigger 429s. */
  minIntervalMs?: number;
  timeoutMs?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  /** A Retry-After longer than this aborts instead of blocking the job. */
  maxRetryAfterMs?: number;
}

export interface Conditional {
  etag?: string | null;
  lastModified?: string | null;
}

export interface Fetched<T> {
  /** 304 means "unchanged since the validators you sent": `data` is null and nothing needs re-processing. */
  status: 200 | 304;
  data: T | null;
  etag: string | null;
  lastModified: string | null;
}

export interface MonthlyArchive {
  /** Raw game objects; validate each with normalizeArchiveGame so one bad entry cannot hide the rest. */
  games: unknown[];
}

const DEFAULT_BASE = "https://api.chess.com/pub";

export class ChessComClient {
  private readonly baseUrl: string;
  private readonly doFetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly opts: Required<
    Pick<
      ChessComClientOptions,
      | "minIntervalMs"
      | "timeoutMs"
      | "maxRetries"
      | "baseBackoffMs"
      | "maxBackoffMs"
      | "maxRetryAfterMs"
    >
  >;
  private readonly userAgent: string;
  /** Serialises all requests made through this client. */
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(options: ChessComClientOptions) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
    this.doFetch = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = options.random ?? Math.random;
    this.userAgent = options.userAgent;
    this.opts = {
      minIntervalMs: options.minIntervalMs ?? 400,
      timeoutMs: options.timeoutMs ?? 10_000,
      maxRetries: options.maxRetries ?? 3,
      baseBackoffMs: options.baseBackoffMs ?? 1_000,
      maxBackoffMs: options.maxBackoffMs ?? 30_000,
      maxRetryAfterMs: options.maxRetryAfterMs ?? 60_000,
    };
  }

  // Every public method is async so validation failures are rejected promises, never
  // synchronous throws that would escape a `.catch()` or `Promise.allSettled`.
  async getProfile(username: string): Promise<ChessComProfile> {
    const r = await this.getJson(`/player/${this.segment(username)}`, ChessComProfileSchema);
    return r.data!;
  }

  async getStats(username: string): Promise<ChessComStats> {
    const r = await this.getJson(`/player/${this.segment(username)}/stats`, ChessComStatsSchema);
    return r.data!;
  }

  async getArchiveIndex(username: string): Promise<string[]> {
    const r = await this.getJson(
      `/player/${this.segment(username)}/games/archives`,
      ChessComArchiveIndexSchema,
    );
    return r.data!.archives;
  }

  /** `month` is "YYYY/MM". Pass validators from a previous fetch to make the request conditional. */
  async getMonthlyArchive(
    username: string,
    month: string,
    conditional?: Conditional,
  ): Promise<Fetched<MonthlyArchive>> {
    if (!/^\d{4}\/(0[1-9]|1[0-2])$/.test(month)) {
      throw new ChessComError("client_error", `invalid archive month: ${month}`);
    }
    const r = await this.getJson(
      `/player/${this.segment(username)}/games/${month}`,
      ChessComMonthlyArchiveSchema,
      conditional,
    );
    return { ...r, data: r.data ? { games: r.data.games } : null };
  }

  /** Path segments are built only from validated usernames, so a value can never escape its slot. */
  private segment(username: string): string {
    const name = normalizeChessUsername(username);
    if (!isValidChessUsername(name)) {
      throw new ChessComError("client_error", "invalid Chess.com username");
    }
    return encodeURIComponent(name);
  }

  private getJson<T>(
    path: string,
    schema: ZodType<T>,
    conditional?: Conditional,
  ): Promise<Fetched<T>> {
    // Chain onto the queue so requests never overlap, even if callers use Promise.all.
    const run = this.queue.then(() => this.requestWithRetry(path, schema, conditional));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async requestWithRetry<T>(
    path: string,
    schema: ZodType<T>,
    conditional?: Conditional,
  ): Promise<Fetched<T>> {
    let attempt = 0;
    for (;;) {
      try {
        await this.pace();
        return await this.requestOnce(path, schema, conditional);
      } catch (error) {
        const err =
          error instanceof ChessComError ? error : new ChessComError("network", String(error));
        const retriable =
          err.kind === "rate_limited" ||
          err.kind === "server_error" ||
          err.kind === "timeout" ||
          err.kind === "network";
        if (!retriable || attempt >= this.opts.maxRetries) throw err;
        if (err.retryAfterMs !== undefined && err.retryAfterMs > this.opts.maxRetryAfterMs)
          throw err;
        const backoff = Math.min(this.opts.maxBackoffMs, this.opts.baseBackoffMs * 2 ** attempt);
        const jitter = Math.floor(this.random() * this.opts.baseBackoffMs);
        await this.sleep(Math.max(err.retryAfterMs ?? 0, backoff + jitter));
        attempt++;
      }
    }
  }

  /** Enforces the minimum gap between consecutive requests. */
  private async pace(): Promise<void> {
    const wait = this.lastRequestAt + this.opts.minIntervalMs - Date.now();
    if (this.lastRequestAt > 0 && wait > 0) await this.sleep(wait);
    this.lastRequestAt = Date.now();
  }

  private async requestOnce<T>(
    path: string,
    schema: ZodType<T>,
    conditional?: Conditional,
  ): Promise<Fetched<T>> {
    const headers: Record<string, string> = {
      "User-Agent": this.userAgent,
      Accept: "application/json",
    };
    if (conditional?.etag) headers["If-None-Match"] = conditional.etag;
    if (conditional?.lastModified) headers["If-Modified-Since"] = conditional.lastModified;

    let res: Response;
    try {
      res = await this.doFetch(`${this.baseUrl}${path}`, {
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(this.opts.timeoutMs),
      });
    } catch (error) {
      const name = (error as { name?: string }).name;
      if (name === "TimeoutError" || name === "AbortError") {
        throw new ChessComError("timeout", `request timed out after ${this.opts.timeoutMs}ms`);
      }
      throw new ChessComError("network", `network error: ${(error as Error).message}`);
    }

    const etag = res.headers.get("etag");
    const lastModified = res.headers.get("last-modified");

    if (res.status === 304)
      return {
        status: 304,
        data: null,
        etag: etag ?? conditional?.etag ?? null,
        lastModified: lastModified ?? conditional?.lastModified ?? null,
      };
    if (res.status === 200) {
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        throw new ChessComError("invalid_response", "response was not valid JSON", 200);
      }
      const parsed = schema.safeParse(body);
      if (!parsed.success)
        throw new ChessComError(
          "invalid_response",
          "response did not match the expected shape",
          200,
        );
      return { status: 200, data: parsed.data, etag, lastModified };
    }
    if (res.status === 301 || res.status === 302 || res.status === 308) {
      // A renamed player. We do not follow it: following would silently re-point an identity.
      throw new ChessComError("moved", "the Chess.com player was renamed or moved", res.status);
    }
    if (res.status === 404) throw new ChessComError("not_found", "not found", 404);
    if (res.status === 410)
      throw new ChessComError("gone", "Chess.com reports this will never have data", 410);
    if (res.status === 429) {
      const retryAfter = Number.parseInt(res.headers.get("retry-after") ?? "", 10);
      throw new ChessComError(
        "rate_limited",
        "rate limited by Chess.com",
        429,
        Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined,
      );
    }
    if (res.status >= 500)
      throw new ChessComError("server_error", `Chess.com returned ${res.status}`, res.status);
    throw new ChessComError("client_error", `unexpected status ${res.status}`, res.status);
  }
}

/** Builds the User-Agent Chess.com asks API consumers to send. */
export function buildUserAgent(appUrl: string, contact: string | null): string {
  return `MNNITChessCommunity/1.0 (+${appUrl}${contact ? `; contact: ${contact}` : ""})`;
}
