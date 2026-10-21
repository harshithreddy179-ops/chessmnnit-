import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ChessComClient } from "@/lib/chess/client";
import { runChallengeSync } from "@/server/sync/challenges";
import { createPgSyncStore } from "../helpers/pg-sync-store";
import { startFakeChessCom, type FakeChessCom } from "../helpers/fake-chesscom";
import { createTestDb, hoursAgo, minutesAgo, type Player, type TestDb } from "./helpers";

/**
 * End-to-end result synchronisation: real ChessComClient -> fake api.chess.com (HTTP) ->
 * real matcher + orchestration -> real PostgreSQL functions, constraints and triggers.
 */
let db: TestDb;
let chess: FakeChessCom;
let alice: Player;
let bob: Player;
let carol: Player;

beforeAll(async () => {
  db = await createTestDb();
  chess = await startFakeChessCom();
  alice = await db.onboard({ username: "alice_f", name: "Alice" });
  bob = await db.onboard({ username: "bob_f", name: "Bob" });
  carol = await db.onboard({ username: "carol_f", name: "Carol" });
  for (const p of [alice, bob, carol])
    chess.setProfile({ username: p.username, player_id: p.playerId });
  chess.setProfile({ username: "stranger_x", player_id: 1 });
});
afterAll(async () => {
  await chess.close();
  await db.close();
});

const sleeps: number[] = [];
const client = () =>
  new ChessComClient({
    userAgent: "test",
    baseUrl: chess.baseUrl,
    minIntervalMs: 0,
    baseBackoffMs: 1,
    maxBackoffMs: 5,
    maxRetries: 2,
    sleep: async (ms) => void sleeps.push(ms),
  });

const store = () => createPgSyncStore(db);
const run = (offsetMs = 0, limit = 10) =>
  runChallengeSync(store(), client(), {
    limit,
    deadline: Date.now() + 30_000,
    now: () => new Date(Date.now() + offsetMs),
  });

/** Accepted three hours ago and due for checking now. */
async function accepted(a: Player, b: Player, tc = "600"): Promise<string> {
  const id = (
    await db
      .as(a.id)
      .query(
        "insert into public.challenges (recipient_id, time_control) values ($1, $2) returning id",
        [b.id, tc],
      )
  ).rows[0].id as string;
  await db.as(b.id).query("update public.challenges set status = 'accepted' where id = $1", [id]);
  await db.admin.query(
    "update public.challenges set accepted_at = now() - interval '3 hours', next_check_at = now() - interval '1 second' where id = $1",
    [id],
  );
  return id;
}
const due = (id: string) =>
  db.admin.query(
    "update public.challenges set next_check_at = now() - interval '1 second' where id = $1",
    [id],
  );
const challenge = async (id: string) =>
  (await db.admin.query("select * from public.challenges where id = $1", [id])).rows[0];
const attempts = async (id: string) =>
  (
    await db.admin.query(
      "select outcome, candidates, error, detail from public.match_sync_attempts where challenge_id = $1 order by id",
      [id],
    )
  ).rows;
const matches = async (id: string) =>
  (await db.admin.query("select * from public.college_matches where challenge_id = $1", [id])).rows;

beforeEach(async () => {
  await db.admin.query("delete from public.college_matches");
  await db.admin.query("delete from public.challenges");
  await db.admin.query("delete from public.imported_chess_games");
  await db.admin.query("delete from public.chess_archive_state");
  await db.admin.query("delete from app_private.rate_limit_buckets");
  chess.clearGames();
  chess.clearFailures();
  chess.resetCounters();
  sleeps.length = 0;
});

describe("automatic result synchronisation", () => {
  it("finds the real game, waits out the settle window, then verifies exactly once", async () => {
    const id = await accepted(alice, bob);
    const game = chess.addGame({
      white: "bob_f",
      black: "alice_f",
      winner: "white",
      endedAt: hoursAgo(1),
    });

    // Pass 1: the game is found but must stay the only candidate for the settle window.
    const first = await run();
    expect(first).toMatchObject({ claimed: 1, settling: 1, verified: 0 });
    let c = await challenge(id);
    expect(c.status).toBe("checking_result");
    expect(c.settle_until.getTime()).toBeGreaterThan(Date.now() + 59 * 60_000);
    expect(await matches(id)).toHaveLength(0);

    // Not due again until the window closes: an immediate re-run touches nothing.
    expect(await run()).toMatchObject({ claimed: 0 });

    // Pass 2, after the window: verified.
    await due(id);
    const second = await run(61 * 60_000);
    expect(second).toMatchObject({ claimed: 1, verified: 1 });
    c = await challenge(id);
    expect(c.status).toBe("result_verified");
    const [m] = await matches(id);
    expect(m).toMatchObject({
      game_url: game.url,
      white_username: "bob_f",
      black_username: "alice_f",
      result: "white",
      source: "automatic",
      status: "verified",
    });
    expect(m.evidence).toMatchObject({
      rules_version: 1,
      checks: { only_candidate: true, players_match: true },
    });

    expect((await attempts(id)).map((a) => a.outcome)).toEqual(["candidate_found", "verified"]);
    expect(
      (
        await db.admin.query(
          "select wins, losses, points from public.player_stats where user_id = $1",
          [bob.id],
        )
      ).rows[0],
    ).toEqual({ wins: 1, losses: 0, points: 3 });

    // Idempotent: nothing left to do, and nothing changes.
    expect(await run(2 * 3_600_000)).toMatchObject({ claimed: 0 });
    expect(await matches(id)).toHaveLength(1);
  });

  it("copes with a delayed archive: nothing yet, then the game appears", async () => {
    const id = await accepted(alice, bob);
    const early = await run();
    expect(early).toMatchObject({ waiting: 1, verified: 0 });
    expect((await challenge(id)).status).toBe("waiting_for_game");

    chess.addGame({ white: "alice_f", black: "bob_f", winner: "draw", endedAt: minutesAgo(30) });
    await due(id);
    expect(await run()).toMatchObject({ settling: 1 });
    await due(id);
    expect(await run(2 * 3_600_000)).toMatchObject({ verified: 1 });
    expect((await matches(id))[0].result).toBe("draw");
    expect((await attempts(id)).map((a) => a.outcome)).toEqual([
      "no_game_found",
      "candidate_found",
      "verified",
    ]);
  });

  it("sets Needs review instead of guessing when several games qualify", async () => {
    const id = await accepted(alice, bob);
    const g1 = chess.addGame({
      white: "alice_f",
      black: "bob_f",
      winner: "white",
      endedAt: hoursAgo(2),
    });
    const g2 = chess.addGame({
      white: "bob_f",
      black: "alice_f",
      winner: "white",
      endedAt: hoursAgo(1),
    });
    const summary = await run();
    expect(summary).toMatchObject({ needsReview: 1, verified: 0 });
    const c = await challenge(id);
    expect(c.status).toBe("needs_review");
    expect(c.review_reason).toMatch(/2 completed games/);
    expect(await matches(id)).toHaveLength(0);
    const last = (await attempts(id)).at(-1)!;
    expect(last.outcome).toBe("ambiguous");
    expect(last.detail.candidates).toEqual(expect.arrayContaining([g1.url, g2.url]));
    // Both players are told a human will decide.
    for (const p of [alice, bob]) {
      expect(
        (
          await db
            .as(p.id)
            .query("select 1 from public.notifications where type = 'match_needs_review'")
        ).rowCount,
      ).toBe(1);
    }
  });

  it("turns a second game that appears during the settle window into a review", async () => {
    const id = await accepted(alice, bob);
    chess.addGame({ white: "alice_f", black: "bob_f", winner: "white", endedAt: hoursAgo(2) });
    await run();
    expect((await challenge(id)).status).toBe("checking_result");
    chess.addGame({ white: "alice_f", black: "bob_f", winner: "black", endedAt: minutesAgo(10) });
    await due(id);
    expect(await run(30 * 60_000)).toMatchObject({ needsReview: 1, verified: 0 });
    expect((await challenge(id)).status).toBe("needs_review");
  });

  it("ignores games that cannot belong to the challenge", async () => {
    const id = await accepted(alice, bob, "600");
    chess.addGame({ white: "alice_f", black: "bob_f", endedAt: hoursAgo(5) }); // before acceptance
    chess.addGame({
      white: "alice_f",
      black: "bob_f",
      endedAt: hoursAgo(1),
      timeControl: "180",
      timeClass: "blitz",
    }); // other control
    chess.addGame({ white: "alice_f", black: "bob_f", endedAt: hoursAgo(1), rules: "chess960" });
    chess.addGame({ white: "alice_f", black: "stranger_x", endedAt: hoursAgo(1) }); // non-member opponent
    expect(await run()).toMatchObject({ waiting: 1, verified: 0 });
    expect((await challenge(id)).status).toBe("waiting_for_game");
    const stored = (
      await db.admin.query("select white_username, black_username from public.imported_chess_games")
    ).rows;
    expect(
      stored.every((g) => g.black_username !== "stranger_x" && g.white_username !== "stranger_x"),
    ).toBe(true);
    const rejected = (await attempts(id))[0]!.detail.rejected as { reason: string }[];
    expect(rejected.map((r) => r.reason).sort()).toEqual([
      "ended_before_acceptance",
      "time_control_mismatch",
      "unsupported_variant",
    ]);
  });

  it("never counts a result it cannot read", async () => {
    const id = await accepted(alice, bob);
    chess.addGame({
      white: "alice_f",
      black: "bob_f",
      endedAt: hoursAgo(1),
      whiteResult: "mystery",
      blackResult: "unknown",
    });
    expect(await run()).toMatchObject({ needsReview: 1, verified: 0 });
    expect((await attempts(id)).at(-1)!.outcome).toBe("unknown_result");
    expect(await matches(id)).toHaveLength(0);
  });

  it("moves to manual review when no game ever appears within the window", async () => {
    const id = await accepted(alice, bob);
    await db.admin.query(
      "update public.challenges set giveup_at = now() - interval '1 minute' where id = $1",
      [id],
    );
    expect(await run()).toMatchObject({ needsReview: 1 });
    expect(await challenge(id)).toMatchObject({
      status: "needs_review",
      review_reason: expect.stringMatching(/no matching Chess.com game/),
    });
    expect((await attempts(id)).at(-1)!.outcome).toBe("gave_up");
  });

  it("will not verify from a partial view when one archive is unavailable", async () => {
    const id = await accepted(alice, bob);
    chess.addGame({ white: "alice_f", black: "bob_f", endedAt: hoursAgo(1) });
    chess.fail(/\/player\/bob_f\/games\//, 503, 99);
    const summary = await run();
    expect(summary).toMatchObject({ deferred: 1, settling: 0, verified: 0 });
    const c = await challenge(id);
    expect(c.status).toBe("waiting_for_game");
    expect((await attempts(id)).at(-1)).toMatchObject({ outcome: "archive_unavailable" });

    // Once the archive recovers, the normal flow resumes.
    chess.clearFailures();
    await due(id);
    expect(await run()).toMatchObject({ settling: 1 });
  });

  it("hands over to a moderator if archives stay unavailable until the deadline", async () => {
    const id = await accepted(alice, bob);
    await db.admin.query(
      "update public.challenges set giveup_at = now() - interval '1 minute' where id = $1",
      [id],
    );
    chess.fail(/\/games\//, 503, 99);
    await run();
    expect((await challenge(id)).status).toBe("needs_review");
  });

  it("stops the whole run when Chess.com asks for a long pause, and tries again later", async () => {
    const one = await accepted(alice, bob);
    const two = await accepted(carol, alice);
    chess.fail(/\/games\//, 429, 99, { "retry-after": "3600" });
    const summary = await run();
    expect(summary.stoppedEarly).toBe(true);
    expect((await attempts(one)).at(-1)).toMatchObject({ outcome: "rate_limited" });
    expect((await challenge(one)).status).toBe("waiting_for_game");
    // The run stopped after the first rate-limited challenge: the second was not even attempted.
    expect(await attempts(two)).toHaveLength(0);
    expect(chess.requests).toHaveLength(1);
    expect(sleeps).toEqual([]); // it did not sit and wait out an hour
  });

  it("retries transient failures with backoff and still completes", async () => {
    const id = await accepted(alice, bob);
    chess.addGame({ white: "alice_f", black: "bob_f", endedAt: hoursAgo(1) });
    chess.fail(/\/player\/alice_f\/games\//, 500, 1);
    chess.fail(/\/player\/bob_f\/games\//, 429, 1, { "retry-after": "1" });
    expect(await run()).toMatchObject({ settling: 1 });
    expect(sleeps.length).toBeGreaterThanOrEqual(2);
    expect((await challenge(id)).status).toBe("checking_result");
  });

  it("uses conditional requests and does not re-import unchanged archives", async () => {
    const id = await accepted(alice, bob);
    chess.addGame({ white: "alice_f", black: "bob_f", endedAt: hoursAgo(1) });
    await run();
    const imported = (
      await db.admin.query("select count(*)::int as n from public.imported_chess_games")
    ).rows[0].n;
    expect(imported).toBe(1); // the game appears in BOTH archives but is stored once
    chess.resetCounters();
    await due(id);
    await run(10 * 60_000);
    expect(chess.conditionalHits).toBe(2); // one 304 per player
    expect(
      (await db.admin.query("select count(*)::int as n from public.imported_chess_games")).rows[0]
        .n,
    ).toBe(1);
    expect(
      (
        await db.admin.query(
          "select etag from public.chess_archive_state where chess_username = 'alice_f'",
        )
      ).rows,
    ).toHaveLength(1);
  });

  it("talks to Chess.com strictly one request at a time", async () => {
    await accepted(alice, bob);
    await accepted(carol, bob);
    chess.addGame({ white: "alice_f", black: "bob_f", endedAt: hoursAgo(1) });
    await run();
    expect(chess.requests.length).toBeGreaterThanOrEqual(2);
    expect(chess.maxConcurrent).toBe(1);
  });

  it("keeps member-vs-member games for other pairs, but attaches nothing to the wrong challenge", async () => {
    const id = await accepted(alice, bob);
    chess.addGame({ white: "alice_f", black: "carol_f", endedAt: hoursAgo(1) }); // a different pair
    expect(await run()).toMatchObject({ waiting: 1 });
    expect(
      (
        await db.admin.query(
          "select count(*)::int as n from public.imported_chess_games where black_username = 'carol_f'",
        )
      ).rows[0].n,
    ).toBe(1);
    expect(await matches(id)).toHaveLength(0);
  });

  it("expires unanswered challenges as part of the same job", async () => {
    const c = await db
      .as(alice.id)
      .query(
        "insert into public.challenges (recipient_id, time_control) values ($1, '600') returning id",
        [carol.id],
      );
    const conn = await db.admin.connect();
    try {
      await conn.query("alter table public.challenges disable trigger challenges_before_update");
      await conn.query(
        "update public.challenges set expires_at = now() - interval '1 minute' where id = $1",
        [c.rows[0].id],
      );
      await conn.query("alter table public.challenges enable trigger challenges_before_update");
    } finally {
      conn.release();
    }
    expect(await run()).toMatchObject({ expired: 1 });
    expect((await challenge(c.rows[0].id)).status).toBe("expired");
  });
});
