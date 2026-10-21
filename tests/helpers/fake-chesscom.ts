import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";

/**
 * A tiny stand-in for api.chess.com that serves the documented response shapes. It lets
 * the real ChessComClient, matcher and SQL run together in integration tests, with
 * scripted misbehaviour (outages, 429s, delays) and request bookkeeping.
 *
 * NOTE: responses are modelled on Chess.com's documentation. They are not captured from
 * the live API (the build sandbox cannot reach it).
 */
export interface FakeProfile {
  username: string;
  player_id?: number;
  location?: string;
  name?: string;
  status?: string;
  avatar?: string;
}

export interface FakeGameSpec {
  white: string;
  black: string;
  /** 'white' | 'black' | 'draw' | custom result codes via whiteResult/blackResult */
  winner?: "white" | "black" | "draw";
  whiteResult?: string;
  blackResult?: string;
  endedAt: Date;
  startedAt?: Date;
  timeControl?: string;
  timeClass?: string;
  rules?: string;
  rated?: boolean;
  url?: string;
  uuid?: string;
}

export interface FakeChessCom {
  baseUrl: string;
  requests: string[];
  conditionalHits: number;
  maxConcurrent: number;
  setProfile(p: FakeProfile): void;
  setStats(username: string, stats: Record<string, unknown>): void;
  addGame(g: FakeGameSpec): { url: string; uuid: string };
  /** Make the next `times` requests whose path matches `pattern` answer with `status`. */
  fail(pattern: RegExp, status: number, times?: number, headers?: Record<string, string>): void;
  clearFailures(): void;
  resetCounters(): void;
  /** Forget every game (and archive version) so tests do not leak into each other. */
  clearGames(): void;
  close(): Promise<void>;
}

const RESULT: Record<string, [string, string]> = {
  white: ["win", "resigned"],
  black: ["resigned", "win"],
  draw: ["agreed", "agreed"],
};

// Game numbers must stay unique even when a test worker restarts and loads this module again.
let counter = Date.now();

export async function startFakeChessCom(port = 0): Promise<FakeChessCom> {
  const profiles = new Map<string, FakeProfile>();
  const stats = new Map<string, Record<string, unknown>>();
  const archives = new Map<string, unknown[]>(); // key: `${username}|${YYYY/MM}`
  const versions = new Map<string, number>();
  const failures: {
    pattern: RegExp;
    status: number;
    left: number;
    headers: Record<string, string>;
  }[] = [];
  let inFlight = 0;

  const state: FakeChessCom = {
    baseUrl: "",
    requests: [],
    conditionalHits: 0,
    maxConcurrent: 0,
    setProfile: (p) => profiles.set(p.username.toLowerCase(), p),
    setStats: (u, s) => stats.set(u.toLowerCase(), s),
    addGame(g) {
      const url = g.url ?? `https://www.chess.com/game/live/${counter++}`;
      const uuid = g.uuid ?? randomUUID();
      const [wr, br] = RESULT[g.winner ?? "white"]!;
      const started = g.startedAt ?? new Date(g.endedAt.getTime() - 10 * 60_000);
      const pad = (n: number) => String(n).padStart(2, "0");
      const d = `${started.getUTCFullYear()}.${pad(started.getUTCMonth() + 1)}.${pad(started.getUTCDate())}`;
      const t = `${pad(started.getUTCHours())}:${pad(started.getUTCMinutes())}:${pad(started.getUTCSeconds())}`;
      const game = {
        url,
        uuid,
        pgn: `[Event "Live Chess"]\n[White "${g.white}"]\n[Black "${g.black}"]\n[UTCDate "${d}"]\n[UTCTime "${t}"]\n\n1. e4 e5`,
        time_control: g.timeControl ?? "600",
        time_class: g.timeClass ?? "rapid",
        rules: g.rules ?? "chess",
        rated: g.rated ?? true,
        end_time: Math.floor(g.endedAt.getTime() / 1000),
        white: { username: g.white, rating: 1500, result: g.whiteResult ?? wr, uuid: randomUUID() },
        black: { username: g.black, rating: 1500, result: g.blackResult ?? br, uuid: randomUUID() },
      };
      const month = `${g.endedAt.getUTCFullYear()}/${pad(g.endedAt.getUTCMonth() + 1)}`;
      // The same game is reported in BOTH players' archives, as Chess.com does.
      for (const user of [g.white, g.black]) {
        const key = `${user.toLowerCase()}|${month}`;
        archives.set(key, [...(archives.get(key) ?? []), game]);
        versions.set(key, (versions.get(key) ?? 0) + 1);
      }
      return { url, uuid };
    },
    fail: (pattern, status, times = 1, headers = {}) =>
      failures.push({ pattern, status, left: times, headers }),
    clearFailures: () => void (failures.length = 0),
    clearGames() {
      archives.clear();
      versions.clear();
    },
    resetCounters() {
      state.requests = [];
      state.conditionalHits = 0;
      state.maxConcurrent = 0;
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };

  const send = (
    res: ServerResponse,
    status: number,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(body === undefined ? undefined : JSON.stringify(body));
  };

  const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    inFlight++;
    state.maxConcurrent = Math.max(state.maxConcurrent, inFlight);
    await new Promise((r) => setTimeout(r, 2)); // widen the window in which overlap would be observed
    try {
      const path = new URL(req.url ?? "/", "http://x").pathname.replace(/^\/pub/, "");
      state.requests.push(path);

      const failure = failures.find((f) => f.left > 0 && f.pattern.test(path));
      if (failure) {
        failure.left--;
        return send(res, failure.status, { message: "scripted failure" }, failure.headers);
      }

      let m = path.match(/^\/player\/([^/]+)\/games\/(\d{4})\/(\d{2})$/);
      if (m) {
        const key = `${m[1]!.toLowerCase()}|${m[2]}/${m[3]}`;
        if (!profiles.has(m[1]!.toLowerCase()))
          return send(res, 404, { code: 0, message: "not found" });
        const version = versions.get(key) ?? 0;
        const etag = `"${key}:${version}"`;
        if (req.headers["if-none-match"] === etag) {
          state.conditionalHits++;
          return send(res, 304, undefined, { etag });
        }
        return send(
          res,
          200,
          { games: archives.get(key) ?? [] },
          { etag, "last-modified": "Wed, 21 Oct 2026 07:28:00 GMT" },
        );
      }
      m = path.match(/^\/player\/([^/]+)\/games\/archives$/);
      if (m) return send(res, 200, { archives: [] });
      m = path.match(/^\/player\/([^/]+)\/stats$/);
      if (m)
        return stats.has(m[1]!.toLowerCase())
          ? send(res, 200, stats.get(m[1]!.toLowerCase()))
          : send(res, 404, {});
      m = path.match(/^\/player\/([^/]+)$/);
      if (m) {
        const p = profiles.get(m[1]!.toLowerCase());
        return p
          ? send(res, 200, {
              "@id": `https://api.chess.com/pub/player/${p.username}`,
              url: `https://www.chess.com/member/${p.username}`,
              ...p,
            })
          : send(res, 404, {});
      }
      send(res, 404, {});
    } finally {
      inFlight--;
    }
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  state.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/pub`;
  return state;
}
