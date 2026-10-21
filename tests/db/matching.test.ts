import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, hoursAgo, sqlError, type Player, type TestDb } from "./helpers";

let db: TestDb;
let alice: Player;
let bob: Player;
let carol: Player;
let mod: { id: string };

beforeAll(async () => {
  db = await createTestDb();
  alice = await db.onboard({ username: "alice_m", name: "Alice" });
  bob = await db.onboard({ username: "bob_m", name: "Bob" });
  carol = await db.onboard({ username: "carol_m", name: "Carol" });
  mod = await db.createUser();
  await db.makeAdmin(mod.id, "match_moderator");
});
afterAll(async () => {
  await db.close();
});

let gameSeq = 1_000;
interface GameSpec {
  white: string;
  black: string;
  winner?: "white" | "black" | "draw" | "unknown";
  endedAt?: Date;
  startedAt?: Date | null;
  tc?: string | null;
  rules?: string;
  rated?: boolean;
}

async function importGame(g: GameSpec): Promise<{ id: string; url: string }> {
  const url = `https://www.chess.com/game/live/${gameSeq++}`;
  const row = {
    game_url: url, game_uuid: randomUUID(), white_username: g.white, black_username: g.black,
    white_rating: 1500, black_rating: 1500, white_result: "win", black_result: "resigned",
    winner: g.winner ?? "white", time_control: g.tc === undefined ? "600" : g.tc, time_class: "rapid",
    rules: g.rules ?? "chess", rated: g.rated ?? true, started_at: g.startedAt ?? null,
    ended_at: (g.endedAt ?? hoursAgo(1)).toISOString(), archive_month: "2026/10",
  };
  await db.service.query("select public.import_chess_games($1::jsonb)", [JSON.stringify([row])]);
  const r = await db.admin.query("select id from public.imported_chess_games where game_url = $1", [url]);
  return { id: r.rows[0].id, url };
}

async function clearAll() {
  await db.admin.query("delete from public.college_matches");
  await db.admin.query("delete from public.challenges");
  await db.admin.query("delete from public.notifications");
  await db.admin.query("delete from app_private.rate_limit_buckets");
}

/** A challenge that was accepted three hours ago, i.e. waiting for a game. */
async function acceptedChallenge(a: Player, b: Player, tc = "600"): Promise<string> {
  const c = await db.as(a.id).query("insert into public.challenges (recipient_id, time_control) values ($1, $2) returning id", [b.id, tc]);
  const id = c.rows[0].id as string;
  await db.as(b.id).query("update public.challenges set status = 'accepted' where id = $1", [id]);
  await db.admin.query("update public.challenges set accepted_at = now() - interval '3 hours' where id = $1", [id]);
  return id;
}

const finalize = (challengeId: string, gameId: string) =>
  db.service.query<{ id: string }>("select public.finalize_challenge_match($1, $2, '{\"by\":\"test\"}'::jsonb) as id", [challengeId, gameId]);

const statsOf = async (p: Player) =>
  (await db.admin.query("select * from public.player_stats where user_id = $1", [p.id])).rows[0];

describe("finalizing a match", () => {
  it("records the real game, updates both players' statistics and notifies them", async () => {
    await clearAll();
    const ch = await acceptedChallenge(alice, bob);
    const game = await importGame({ white: "bob_m", black: "alice_m", winner: "white" });
    await finalize(ch, game.id);

    const m = (await db.admin.query("select * from public.college_matches where challenge_id = $1", [ch])).rows[0];
    expect(m).toMatchObject({
      game_url: game.url, white_user_id: bob.id, black_user_id: alice.id, white_username: "bob_m", black_username: "alice_m",
      result: "white", status: "verified", source: "automatic", time_class: "rapid", time_control: "600",
    });
    expect(m.evidence).toMatchObject({ by: "test" });
    expect((await db.admin.query("select status from public.challenges where id = $1", [ch])).rows[0].status).toBe("result_verified");

    expect(await statsOf(bob)).toMatchObject({ games_played: 1, wins: 1, losses: 0, draws: 0, points: 3 });
    expect(await statsOf(alice)).toMatchObject({ games_played: 1, wins: 0, losses: 1, draws: 0, points: 0 });
    expect(Number((await statsOf(bob)).elo)).toBe(1016);
    expect(Number((await statsOf(alice)).elo)).toBe(984);

    for (const p of [alice, bob]) {
      expect((await db.as(p.id).query("select 1 from public.notifications where type = 'match_verified'")).rowCount).toBe(1);
    }
  });

  it("is idempotent: processing the same result again changes nothing", async () => {
    await clearAll();
    const ch = await acceptedChallenge(alice, bob);
    const game = await importGame({ white: "alice_m", black: "bob_m", winner: "draw" });
    await finalize(ch, game.id);
    const before = [await statsOf(alice), await statsOf(bob)];

    const again = await sqlError(finalize(ch, game.id));
    expect(again.message).toMatch(/challenge_not_open/);
    await db.service.query("select public.recompute_all_stats()");
    await db.service.query("select public.recompute_all_stats()");

    const withoutTimestamp = (row: Record<string, unknown>) => ({ ...row, updated_at: undefined });
    expect([await statsOf(alice), await statsOf(bob)].map(withoutTimestamp)).toEqual(before.map(withoutTimestamp));
    expect((await db.admin.query("select count(*)::int as n from public.college_matches")).rows[0].n).toBe(1);
    expect(before[0]).toMatchObject({ games_played: 1, draws: 1, points: 1 });
  });

  it("never counts one game twice, across challenges or by direct insert", async () => {
    await clearAll();
    const first = await acceptedChallenge(alice, bob);
    const game = await importGame({ white: "alice_m", black: "bob_m", winner: "white", endedAt: hoursAgo(2) });
    await finalize(first, game.id);

    // A later challenge between the same pair must not be able to reuse that game.
    const second = await acceptedChallenge(alice, bob);
    await db.admin.query("update public.challenges set accepted_at = now() - interval '5 hours' where id = $1", [second]);
    const reuse = await sqlError(finalize(second, game.id));
    expect(reuse.code).toBe("23505");
    expect(reuse.message).toMatch(/game_already_counted/);
    const viaModerator = await sqlError(db.as(mod.id).query("select public.admin_resolve_challenge_with_game($1, $2, 'trying to reuse a game')", [second, game.url]));
    expect(viaModerator.message).toMatch(/game_already_counted/);

    // Database-level backstops, independent of any function.
    const dupUrl = await sqlError(
      db.service.query(
        `insert into public.college_matches (challenge_id, game_url, white_username, black_username, result, ended_at, source)
         values ($1, $2, 'alice_m', 'bob_m', 'white', now(), 'admin')`,
        [second, game.url],
      ),
    );
    expect(dupUrl.code).toBe("23505");
    const dupChallenge = await sqlError(
      db.service.query(
        `insert into public.college_matches (challenge_id, game_url, white_username, black_username, result, ended_at, source)
         values ($1, 'https://www.chess.com/game/live/777777777', 'alice_m', 'bob_m', 'white', now(), 'admin')`,
        [first],
      ),
    );
    expect(dupChallenge.code).toBe("23505");
    expect((await db.admin.query("select count(*)::int as n from public.college_matches")).rows[0].n).toBe(1);
  });

  it("only accepts a game played between the two challenge participants", async () => {
    await clearAll();
    const ch = await acceptedChallenge(alice, bob);
    const wrong = await importGame({ white: "alice_m", black: "carol_m" });
    expect((await sqlError(finalize(ch, wrong.id))).message).toMatch(/game_players_mismatch/);
    const alsoWrong = await importGame({ white: "carol_m", black: "bob_m" });
    expect((await sqlError(finalize(ch, alsoWrong.id))).message).toMatch(/game_players_mismatch/);
    expect((await db.admin.query("select status from public.challenges where id = $1", [ch])).rows[0].status).toBe("accepted");
  });

  it("rejects games that started or ended before the challenge was accepted", async () => {
    await clearAll();
    const ch = await acceptedChallenge(alice, bob);
    const early = await importGame({ white: "alice_m", black: "bob_m", endedAt: hoursAgo(5) });
    expect((await sqlError(finalize(ch, early.id))).message).toMatch(/game_before_acceptance/);
    const startedEarly = await importGame({ white: "alice_m", black: "bob_m", endedAt: hoursAgo(1), startedAt: hoursAgo(4) });
    expect((await sqlError(finalize(ch, startedEarly.id))).message).toMatch(/game_before_acceptance/);
  });

  it("rejects a different time control, unknown results and non-standard variants", async () => {
    await clearAll();
    const ch = await acceptedChallenge(alice, bob, "600");
    const blitz = await importGame({ white: "alice_m", black: "bob_m", tc: "180" });
    expect((await sqlError(finalize(ch, blitz.id))).message).toMatch(/time_control_mismatch/);
    const unknown = await importGame({ white: "alice_m", black: "bob_m", winner: "unknown" });
    expect((await sqlError(finalize(ch, unknown.id))).message).toMatch(/result_unknown/);
    const variant = await importGame({ white: "alice_m", black: "bob_m", rules: "chess960" });
    expect((await sqlError(finalize(ch, variant.id))).message).toMatch(/unsupported_variant/);
    // Time control missing from the API payload is "not determinable", which is allowed.
    const unspecified = await importGame({ white: "alice_m", black: "bob_m", tc: null });
    await finalize(ch, unspecified.id);
    expect((await db.admin.query("select status from public.challenges where id = $1", [ch])).rows[0].status).toBe("result_verified");
  });

  it("cannot finalize a challenge that was never accepted or already closed", async () => {
    await clearAll();
    const pending = await db.as(alice.id).query("insert into public.challenges (recipient_id, time_control) values ($1, '600') returning id", [bob.id]);
    const game = await importGame({ white: "alice_m", black: "bob_m" });
    expect((await sqlError(finalize(pending.rows[0].id, game.id))).message).toMatch(/challenge_not_open/);
  });

  it("is not callable by players", async () => {
    await clearAll();
    const ch = await acceptedChallenge(alice, bob);
    const game = await importGame({ white: "alice_m", black: "bob_m" });
    expect((await sqlError(db.as(alice.id).query("select public.finalize_challenge_match($1, $2)", [ch, game.id]))).code).toBe("42501");
  });
});

describe("statistics are exact and match an independent reference model", () => {
  /** Reference implementation written separately from the SQL. */
  function reference(matches: { w: string; b: string; r: "white" | "black" | "draw" }[]) {
    const elo = new Map<string, number>();
    const s = new Map<string, { g: number; w: number; l: number; d: number }>();
    const get = (k: string) => elo.get(k) ?? 1000;
    const bump = (k: string, f: (v: { g: number; w: number; l: number; d: number }) => void) => {
      const v = s.get(k) ?? { g: 0, w: 0, l: 0, d: 0 };
      f(v);
      v.g++;
      s.set(k, v);
    };
    for (const m of matches) {
      const ew = 1 / (1 + 10 ** ((get(m.b) - get(m.w)) / 400));
      const score = m.r === "white" ? 1 : m.r === "black" ? 0 : 0.5;
      elo.set(m.w, get(m.w) + 32 * (score - ew));
      elo.set(m.b, get(m.b) + 32 * (1 - score - (1 - ew)));
      bump(m.w, (v) => (m.r === "white" ? v.w++ : m.r === "black" ? v.l++ : v.d++));
      bump(m.b, (v) => (m.r === "black" ? v.w++ : m.r === "white" ? v.l++ : v.d++));
    }
    return { elo, s };
  }

  it("computes wins, losses, draws, points, win rate and Elo", async () => {
    await clearAll();
    const script: { w: Player; b: Player; r: "white" | "black" | "draw" }[] = [
      { w: alice, b: bob, r: "white" }, { w: bob, b: alice, r: "draw" }, { w: alice, b: carol, r: "black" },
      { w: carol, b: bob, r: "white" }, { w: bob, b: carol, r: "black" }, { w: alice, b: bob, r: "white" },
      { w: carol, b: alice, r: "draw" }, { w: bob, b: alice, r: "black" },
    ];
    let t = 100;
    for (const m of script) {
      await db.admin.query(
        `insert into public.college_matches (game_url, white_user_id, black_user_id, white_username, black_username, result, ended_at, source)
         values ($1, $2, $3, $4, $5, $6, now() - ($7 || ' minutes')::interval, 'automatic')`,
        [`https://www.chess.com/game/live/${gameSeq++}`, m.w.id, m.b.id, m.w.username, m.b.username, m.r, String(t--)],
      );
    }
    const ref = reference(script.map((m) => ({ w: m.w.id, b: m.b.id, r: m.r })));
    for (const p of [alice, bob, carol]) {
      const row = await statsOf(p);
      const exp = ref.s.get(p.id)!;
      expect(row.games_played).toBe(exp.g);
      expect(row.wins).toBe(exp.w);
      expect(row.losses).toBe(exp.l);
      expect(row.draws).toBe(exp.d);
      expect(row.points).toBe(exp.w * 3 + exp.d); // win = 3, draw = 1, loss = 0
      expect(Number(row.win_rate)).toBeCloseTo(exp.w / exp.g, 4); // denominator includes draws
      expect(Math.abs(Number(row.elo) - ref.elo.get(p.id)!)).toBeLessThan(0.11);
    }
    // Elo is zero-sum between the three players.
    const total = [alice, bob, carol].reduce((acc, p) => acc + ref.elo.get(p.id)!, 0);
    expect(total).toBeCloseTo(3000, 6);
  });

  it("excludes disputed and voided matches, and restores them when a moderator rules", async () => {
    await clearAll();
    const ch = await acceptedChallenge(alice, bob);
    const game = await importGame({ white: "alice_m", black: "bob_m", winner: "white" });
    await finalize(ch, game.id);
    expect(await statsOf(alice)).toMatchObject({ wins: 1 });

    // A player disputes the verified result: it stops counting immediately.
    await db.as(bob.id).query("select * from public.open_match_dispute($1, 'I resigned by accident, the opponent agreed to a draw')", [ch]);
    expect((await db.admin.query("select status from public.college_matches where challenge_id = $1", [ch])).rows[0].status).toBe("disputed");
    expect(await statsOf(alice)).toBeUndefined();
    const lb = await db.anon.query("select * from public.get_leaderboard('wins', 'rapid', 10, 0)");
    expect(lb.rows.find((r) => r.chess_username === "alice_m")).toBeUndefined();
    expect((await db.anon.query("select * from public.get_recent_matches(10, 0)")).rows.some((r) => r.game_url === game.url)).toBe(false);

    // The moderator corrects the result; audit trail records before/after and the reason.
    const matchId = (await db.admin.query("select id from public.college_matches where challenge_id = $1", [ch])).rows[0].id;
    await db.as(mod.id).query("select public.admin_correct_match($1, 'draw', 'Both players confirmed a draw by agreement in chat')", [matchId]);
    expect(await statsOf(alice)).toMatchObject({ wins: 0, draws: 1, points: 1 });
    const audit = (await db.admin.query("select actor_id, reason, before_data, after_data from public.audit_logs where action = 'match.corrected'")).rows[0];
    expect(audit).toMatchObject({ actor_id: mod.id, reason: "Both players confirmed a draw by agreement in chat" });
    expect(audit.before_data.result).toBe("white");
    expect(audit.after_data.result).toBe("draw");
    expect((await db.admin.query("select status from public.match_disputes where challenge_id = $1", [ch])).rows[0].status).toBe("resolved");

    // Voiding removes it for good.
    await db.as(mod.id).query("select public.admin_void_challenge($1, 'Game was played against a different account')", [ch]);
    expect(await statsOf(alice)).toBeUndefined();
    expect((await db.admin.query("select status from public.college_matches where id = $1", [matchId])).rows[0].status).toBe("voided");
  });

  it("keeps an opponent's rating stable when a player deletes their account", async () => {
    await clearAll();
    const dave = await db.onboard({ username: "dave_m" });
    await db.admin.query(
      `insert into public.college_matches (game_url, white_user_id, black_user_id, white_username, black_username, result, ended_at, source)
       values ('https://www.chess.com/game/live/990001', $1, $2, 'alice_m', 'dave_m', 'white', now() - interval '3 hours', 'automatic'),
              ('https://www.chess.com/game/live/990002', $1, $2, 'alice_m', 'dave_m', 'draw',  now() - interval '2 hours', 'automatic')`,
      [alice.id, dave.id],
    );
    const before = await statsOf(alice);
    expect(before).toMatchObject({ games_played: 2, wins: 1, draws: 1 });

    await db.admin.query("delete from auth.users where id = $1", [dave.id]);
    const after = await statsOf(alice);
    expect(after).toMatchObject({ games_played: 2, wins: 1, draws: 1, points: before.points });
    expect(after.elo).toBe(before.elo);
    expect(await statsOf(dave)).toBeUndefined();
    const m = await db.admin.query("select black_user_id, black_username from public.college_matches order by game_url");
    expect(m.rows).toEqual([
      { black_user_id: null, black_username: "dave_m" },
      { black_user_id: null, black_username: "dave_m" },
    ]);
    expect((await db.admin.query("select count(*)::int as n from public.audit_logs where action = 'account.deleted' and target_id = $1", [dave.id])).rows[0].n).toBe(1);
  });
});

describe("moderator resolution of stuck or ambiguous challenges", () => {
  it("lets a moderator pick the right game for a challenge in review, with an audit entry", async () => {
    await clearAll();
    const ch = await acceptedChallenge(alice, bob);
    const g1 = await importGame({ white: "alice_m", black: "bob_m", winner: "white", endedAt: hoursAgo(2) });
    await importGame({ white: "bob_m", black: "alice_m", winner: "black", endedAt: hoursAgo(1) });
    await db.service.query("select public.record_challenge_check($1, 'ambiguous', 'needs_review', null, null, '{}', '{}', null, 'two candidate games')", [ch]);

    // Nobody but a match moderator may resolve it.
    const analyst = await db.createUser();
    await db.makeAdmin(analyst.id, "analyst");
    const verifier = await db.createUser();
    await db.makeAdmin(verifier.id, "verification_admin");
    for (const actor of [alice.id, analyst.id, verifier.id]) {
      expect((await sqlError(db.as(actor).query("select public.admin_resolve_challenge_with_game($1, $2, 'not my job really')", [ch, g1.url]))).code).toBe("42501");
    }
    expect((await sqlError(db.as(mod.id).query("select public.admin_resolve_challenge_with_game($1, $2, '')", [ch, g1.url]))).code).toBe("22023");

    await db.as(mod.id).query("select public.admin_resolve_challenge_with_game($1, $2, 'Players confirmed game one was the match')", [ch, g1.url]);
    expect((await db.admin.query("select status from public.challenges where id = $1", [ch])).rows[0].status).toBe("result_verified");
    expect((await db.admin.query("select source, verified_by from public.college_matches where challenge_id = $1", [ch])).rows[0]).toMatchObject({ source: "admin", verified_by: mod.id });
    const audit = await db.admin.query("select actor_id, action from public.audit_logs where action = 'match.resolved_with_game'");
    expect(audit.rows).toEqual([{ actor_id: mod.id, action: "match.resolved_with_game" }]);
  });

  it("refuses to resolve with a game the system has not imported, and allows a flagged manual entry", async () => {
    await clearAll();
    const ch = await acceptedChallenge(alice, bob);
    await db.service.query("select public.record_challenge_check($1, 'gave_up', 'needs_review', null, null, '{}', '{}', null, 'no game found within 72h')", [ch]);
    const missing = await sqlError(db.as(mod.id).query("select public.admin_resolve_challenge_with_game($1, 'https://www.chess.com/game/live/4040404', 'it exists, trust me')", [ch]));
    expect(missing.message).toMatch(/game_not_imported/);

    expect((await sqlError(db.as(mod.id).query("select public.admin_record_manual_result($1, 'https://example.com/not-chess', 'challenger', true, now(), 'screenshot reviewed by both players')", [ch]))).code).toBe("22023");
    expect((await sqlError(db.as(mod.id).query("select public.admin_record_manual_result($1, 'https://www.chess.com/game/live/4040404', 'challenger', true, now(), 'short')", [ch]))).code).toBe("22023");

    await db.as(mod.id).query("select public.admin_record_manual_result($1, 'https://www.chess.com/game/live/4040404', 'recipient', true, now() - interval '1 hour', 'Both players sent matching screenshots of the final position')", [ch]);
    const m = (await db.admin.query("select result, source, evidence, white_user_id from public.college_matches where challenge_id = $1", [ch])).rows[0];
    // Alice (challenger) had white, Bob (recipient) won => black won.
    expect(m).toMatchObject({ result: "black", source: "admin", white_user_id: alice.id });
    expect(m.evidence).toMatchObject({ manual_entry: true, api_verified: false });
    expect(await statsOf(bob)).toMatchObject({ wins: 1 });
  });

  it("returns a reviewed challenge to automatic checking when asked to retry", async () => {
    await clearAll();
    const ch = await acceptedChallenge(alice, bob);
    await db.service.query("select public.record_challenge_check($1, 'gave_up', 'needs_review', null, null, '{}', '{}', null, 'timeout')", [ch]);
    await db.as(mod.id).query("select public.admin_retry_challenge_sync($1)", [ch]);
    const row = (await db.admin.query("select status, review_reason, check_count from public.challenges where id = $1", [ch])).rows[0];
    expect(row).toMatchObject({ status: "waiting_for_game", review_reason: null, check_count: 0 });
    expect((await sqlError(db.as(mod.id).query("select public.admin_retry_challenge_sync($1)", [ch]))).code).toBe("P0001");
  });
});

describe("disputes", () => {
  it("lets only participants dispute, holds the challenge for review and notifies the opponent", async () => {
    await clearAll();
    const ch = await acceptedChallenge(alice, bob);
    await db.service.query("select public.record_challenge_check($1, 'no_game_found', 'waiting_for_game', now() + interval '1 hour')", [ch]);

    expect((await sqlError(db.as(carol.id).query("select * from public.open_match_dispute($1, 'I was not even in this match but object')", [ch]))).code).toBe("P0002");
    expect((await sqlError(db.as(alice.id).query("select * from public.open_match_dispute($1, 'too short')", [ch]))).code).toBe("23514");

    const d = await db.as(alice.id).query("select * from public.open_match_dispute($1, 'We played on Chess.com but the game never appeared', 'https://www.chess.com/game/live/5050505', 'challenger')", [ch]);
    expect(d.rows[0]).toMatchObject({ status: "open", opened_by: alice.id });
    expect((await db.admin.query("select status from public.challenges where id = $1", [ch])).rows[0].status).toBe("needs_review");
    expect((await db.as(bob.id).query("select 1 from public.notifications where type = 'dispute_update'")).rowCount).toBe(1);
    expect((await sqlError(db.as(alice.id).query("select * from public.open_match_dispute($1, 'Opening a second dispute again right now')", [ch]))).message).toMatch(/already have an open dispute|cannot be disputed/);

    // Visible to both participants and moderators, not to bystanders.
    expect((await db.as(bob.id).query("select 1 from public.match_disputes")).rowCount).toBe(1);
    expect((await db.as(mod.id).query("select 1 from public.match_disputes")).rowCount).toBe(1);
    expect((await db.as(carol.id).query("select 1 from public.match_disputes")).rowCount).toBe(0);

    await db.as(mod.id).query("select public.admin_resolve_dispute($1, 'rejected', 'No evidence of a game; asked players to replay')", [d.rows[0].id]);
    expect((await db.admin.query("select status, resolved_by from public.match_disputes where id = $1", [d.rows[0].id])).rows[0]).toMatchObject({ status: "rejected", resolved_by: mod.id });
    expect((await db.as(alice.id).query("select 1 from public.notifications where type = 'dispute_update'")).rowCount).toBe(1);
  });
});
