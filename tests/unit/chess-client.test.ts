import { describe, expect, it, vi } from "vitest";
import { ChessComClient, ChessComError, buildUserAgent } from "@/lib/chess/client";

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function setup(
  handler: Handler,
  extra: Partial<ConstructorParameters<typeof ChessComClient>[0]> = {},
) {
  const calls: { url: string; init: RequestInit; at: number }[] = [];
  const sleeps: number[] = [];
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {}, at: calls.length });
    return handler(String(url), init ?? {});
  });
  const client = new ChessComClient({
    userAgent: "test-agent (+https://example.test; contact: ops@example.test)",
    baseUrl: "https://api.chess.test/pub",
    fetch: fetchMock as unknown as typeof fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0,
    minIntervalMs: 0,
    baseBackoffMs: 100,
    maxBackoffMs: 10_000,
    ...extra,
  });
  return { client, calls, sleeps, fetchMock };
}

describe("ChessComClient", () => {
  it("builds documented endpoint URLs from validated usernames and identifies itself", async () => {
    const { client, calls } = setup((url) => {
      if (url.endsWith("/stats")) return json({ chess_rapid: { last: { rating: 1500 } } });
      if (url.endsWith("/games/archives"))
        return json({ archives: ["https://api.chess.com/pub/player/x/games/2026/10"] });
      if (url.includes("/games/2026/10")) return json({ games: [] });
      return json({ username: "Some_User", player_id: 7 });
    });
    await client.getProfile("  Some_User ");
    await client.getStats("some_user");
    await client.getArchiveIndex("some_user");
    await client.getMonthlyArchive("some_user", "2026/10");
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.chess.test/pub/player/some_user",
      "https://api.chess.test/pub/player/some_user/stats",
      "https://api.chess.test/pub/player/some_user/games/archives",
      "https://api.chess.test/pub/player/some_user/games/2026/10",
    ]);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["User-Agent"]).toContain("contact: ops@example.test");
    expect(headers.Accept).toBe("application/json");
  });

  it("refuses usernames or months that could alter the request path", async () => {
    const { client, fetchMock } = setup(() => json({}));
    for (const bad of ["../admin", "a/b", "user name", "x".repeat(40), "", "us?er"]) {
      await expect(client.getProfile(bad)).rejects.toMatchObject({ kind: "client_error" });
    }
    await expect(client.getMonthlyArchive("valid_user", "2026/13")).rejects.toMatchObject({
      kind: "client_error",
    });
    await expect(client.getMonthlyArchive("valid_user", "../../etc")).rejects.toMatchObject({
      kind: "client_error",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps documented status codes to typed errors without retrying client errors", async () => {
    for (const [status, kind] of [
      [404, "not_found"],
      [410, "gone"],
      [301, "moved"],
      [403, "client_error"],
    ] as const) {
      const { client, fetchMock } = setup(() => new Response("", { status }));
      await expect(client.getProfile("someone")).rejects.toMatchObject({ kind, status });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it("does not follow redirects (a renamed player must be re-reviewed by a human)", async () => {
    const { client, calls } = setup(
      () =>
        new Response("", {
          status: 301,
          headers: { location: "https://api.chess.com/pub/player/new_name" },
        }),
    );
    await expect(client.getProfile("old_name")).rejects.toMatchObject({ kind: "moved" });
    expect((calls[0]!.init as { redirect?: string }).redirect).toBe("manual");
  });

  it("retries 5xx and network failures with exponential backoff, then succeeds", async () => {
    let n = 0;
    const { client, sleeps } = setup(() => {
      n++;
      if (n === 1) return new Response("", { status: 503 });
      if (n === 2) throw new TypeError("fetch failed");
      return json({ username: "someone" });
    });
    await expect(client.getProfile("someone")).resolves.toMatchObject({ username: "someone" });
    expect(n).toBe(3);
    expect(sleeps).toEqual([100, 200]); // base * 2^attempt (jitter is 0 in this test)
  });

  it("gives up after maxRetries with the last error kind", async () => {
    const { client, fetchMock } = setup(() => new Response("", { status: 500 }), { maxRetries: 2 });
    await expect(client.getProfile("someone")).rejects.toMatchObject({
      kind: "server_error",
      status: 500,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("honours Retry-After on 429 and waits at least that long", async () => {
    let n = 0;
    const { client, sleeps } = setup(() => {
      n++;
      return n === 1
        ? new Response("", { status: 429, headers: { "retry-after": "7" } })
        : json({ username: "someone" });
    });
    await client.getProfile("someone");
    expect(sleeps[0]).toBeGreaterThanOrEqual(7000);
  });

  it("aborts a run instead of sleeping when Retry-After is unreasonably long", async () => {
    const { client, sleeps } = setup(
      () => new Response("", { status: 429, headers: { "retry-after": "3600" } }),
      { maxRetryAfterMs: 60_000 },
    );
    const err = (await client.getProfile("someone").catch((e) => e)) as ChessComError;
    expect(err.kind).toBe("rate_limited");
    expect(err.retryAfterMs).toBe(3_600_000);
    expect(sleeps).toEqual([]);
  });

  it("times out slow responses and reports a timeout", async () => {
    const { client } = setup(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "TimeoutError" })),
          );
        }),
      { timeoutMs: 20, maxRetries: 0 },
    );
    await expect(client.getProfile("someone")).rejects.toMatchObject({ kind: "timeout" });
  });

  it("rejects malformed bodies instead of passing them on", async () => {
    const notJson = setup(() => new Response("<html>oops</html>", { status: 200 }));
    await expect(notJson.client.getProfile("someone")).rejects.toMatchObject({
      kind: "invalid_response",
    });
    const wrongShape = setup(() => json({ nope: true }));
    await expect(wrongShape.client.getProfile("someone")).rejects.toMatchObject({
      kind: "invalid_response",
    });
    await expect(
      setup(() => json({ archives: "not-an-array" })).client.getArchiveIndex("someone"),
    ).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it("tolerates unknown extra fields and missing optional ones", async () => {
    const { client } = setup(() => json({ username: "someone", brand_new_field: { a: 1 } }));
    const p = await client.getProfile("someone");
    expect(p.player_id).toBeUndefined();
    expect(p.location).toBeUndefined();
  });

  it("sends validators and understands 304 Not Modified", async () => {
    let seen: Record<string, string> = {};
    const { client } = setup((_url, init) => {
      seen = init.headers as Record<string, string>;
      return new Response(null, { status: 304 });
    });
    const r = await client.getMonthlyArchive("someone", "2026/10", {
      etag: '"abc"',
      lastModified: "Wed, 21 Oct 2026 07:28:00 GMT",
    });
    expect(seen["If-None-Match"]).toBe('"abc"');
    expect(seen["If-Modified-Since"]).toBe("Wed, 21 Oct 2026 07:28:00 GMT");
    expect(r).toMatchObject({ status: 304, data: null, etag: '"abc"' });
  });

  it("captures validators from a 200 for the next conditional request", async () => {
    const { client } = setup(() =>
      json(
        { games: [{ url: "x" }] },
        { headers: { etag: '"v2"', "last-modified": "Thu, 22 Oct 2026 00:00:00 GMT" } },
      ),
    );
    const r = await client.getMonthlyArchive("someone", "2026/10");
    expect(r).toMatchObject({
      status: 200,
      etag: '"v2"',
      lastModified: "Thu, 22 Oct 2026 00:00:00 GMT",
    });
    expect(r.data?.games).toHaveLength(1);
  });

  it("never runs two requests at once, even when callers use Promise.all", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const { client } = setup(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return json({ username: "someone" });
    });
    await Promise.all(Array.from({ length: 6 }, () => client.getProfile("someone")));
    expect(maxInFlight).toBe(1);
  });

  it("spaces consecutive requests by the configured minimum interval", async () => {
    const { client, sleeps } = setup(() => json({ username: "someone" }), { minIntervalMs: 250 });
    await client.getProfile("someone");
    await client.getProfile("someone");
    expect(sleeps.some((s) => s > 0 && s <= 250)).toBe(true);
  });

  it("keeps working after one failed request in the queue", async () => {
    let n = 0;
    const { client } = setup(
      () => (++n === 1 ? new Response("", { status: 404 }) : json({ username: "someone" })),
      { maxRetries: 0 },
    );
    const results = await Promise.allSettled([
      client.getProfile("ghost"),
      client.getProfile("someone"),
    ]);
    expect(results[0]!.status).toBe("rejected");
    expect(results[1]!.status).toBe("fulfilled");
  });
});

describe("buildUserAgent", () => {
  it("includes the application URL and contact when configured", () => {
    expect(buildUserAgent("https://chess.example", "ops@example.test")).toBe(
      "MNNITChessCommunity/1.0 (+https://chess.example; contact: ops@example.test)",
    );
    expect(buildUserAgent("https://chess.example", null)).toBe(
      "MNNITChessCommunity/1.0 (+https://chess.example)",
    );
  });
});
