import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChessComClient } from "@/lib/chess/client";
import { checkProfileCode } from "@/lib/chess/verification/profile-code";
import { ratingsFromStats, runPlayerSync, syncOnePlayer } from "@/server/sync/players";
import { startFakeChessCom, type FakeChessCom } from "../helpers/fake-chesscom";
import { createPgRpc } from "../helpers/pg-rpc";
import { createTestDb, type TestDb } from "./helpers";

/**
 * The complete ownership round trip, app side:
 *   database issues a code  ->  owner edits their Chess.com profile (simulated)  ->
 *   server reads the public profile through the real client  ->  database links the account.
 * The Chess.com side is a local fake modelled on the documented API; the "owner edits their
 * profile" step is simulated here, which is exactly the step that must be validated against
 * the live service by an operator (see docs/CHESSCOM_INTEGRATION.md).
 */
let db: TestDb;
let chess: FakeChessCom;

beforeAll(async () => {
  db = await createTestDb();
  chess = await startFakeChessCom();
});
afterAll(async () => {
  await chess.close();
  await db.close();
});

const client = () =>
  new ChessComClient({
    userAgent: "test",
    baseUrl: chess.baseUrl,
    minIntervalMs: 0,
    maxRetries: 0,
    sleep: async () => undefined,
  });

async function eligible() {
  const u = await db.createUser();
  await db.allowEmail(u.email);
  await db.as(u.id).query("select public.claim_eligibility()");
  return u;
}
const claimFor = async (userId: string, username: string) =>
  (
    await db
      .as(userId)
      .query<{ id: string; verification_code: string }>(
        "select * from public.start_chess_claim($1)",
        [username],
      )
  ).rows[0]!;

async function confirmWith(claimId: string, result: { username: string; playerId: number | null }) {
  return (
    await db.service.query("select public.confirm_chess_link($1, $2, $3, 'profile_code') as r", [
      claimId,
      result.username,
      result.playerId,
    ])
  ).rows[0].r;
}

describe("profile-code ownership round trip", () => {
  it("links the account only after the code really appears on the public profile", async () => {
    const u = await eligible();
    chess.setProfile({ username: "Owner_One", player_id: 424242, location: "Prayagraj" });
    const claim = await claimFor(u.id, "owner_one");

    // 1. Before the edit: the code is not there, nothing is verified, and nothing is linked.
    const before = await checkProfileCode(client(), {
      username: "owner_one",
      code: claim.verification_code,
    });
    expect(before).toEqual({ verified: false, reason: "code_not_found" });
    await db.service.query("select public.record_claim_check($1, 'code_not_found')", [claim.id]);
    expect(
      (
        await db.admin.query(
          "select count(*)::int as n from public.chess_account_links where user_id = $1",
          [u.id],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await db.admin.query(
          "select attempts, last_check_result from public.chess_link_claims where id = $1",
          [claim.id],
        )
      ).rows[0],
    ).toEqual({ attempts: 1, last_check_result: "code_not_found" });

    // 2. The owner edits their Chess.com location to include the code.
    chess.setProfile({
      username: "Owner_One",
      player_id: 424242,
      location: `Prayagraj · ${claim.verification_code}`,
    });
    const after = await checkProfileCode(client(), {
      username: "owner_one",
      code: claim.verification_code,
    });
    expect(after).toEqual({ verified: true, username: "owner_one", playerId: 424242 });
    if (!after.verified) throw new Error("unreachable");

    // 3. The trusted server confirms; the database creates the one-to-one link.
    expect(await confirmWith(claim.id, after)).toMatchObject({
      ok: true,
      chess_username: "owner_one",
    });
    const link = (
      await db.admin.query(
        "select chess_username, chess_player_id::int as chess_player_id, verification_method from public.chess_account_links where user_id = $1",
        [u.id],
      )
    ).rows[0];
    expect(link).toEqual({
      chess_username: "owner_one",
      chess_player_id: 424242,
      verification_method: "profile_code",
    });
    expect(
      (
        await db
          .as(u.id)
          .query("select title from public.notifications where type = 'verification_result'")
      ).rowCount,
    ).toBe(1);
  });

  it("cannot be hijacked by claiming someone else's username", async () => {
    const owner = await eligible();
    const attacker = await eligible();
    chess.setProfile({ username: "victim_acct", player_id: 5150, location: "Somewhere" });
    const ownerClaim = await claimFor(owner.id, "victim_acct");
    const attackerClaim = await claimFor(attacker.id, "victim_acct"); // allowed to start, but proves nothing

    // Only the real owner can edit the profile; they use THEIR code.
    chess.setProfile({
      username: "victim_acct",
      player_id: 5150,
      location: ownerClaim.verification_code,
    });
    expect(
      await checkProfileCode(client(), {
        username: "victim_acct",
        code: attackerClaim.verification_code,
      }),
    ).toEqual({ verified: false, reason: "code_not_found" });
    const real = await checkProfileCode(client(), {
      username: "victim_acct",
      code: ownerClaim.verification_code,
    });
    expect(real.verified).toBe(true);
    if (real.verified) expect(await confirmWith(ownerClaim.id, real)).toMatchObject({ ok: true });

    // Even a forged "observed" result for the attacker's claim loses to the unique constraint.
    expect(
      await confirmWith(attackerClaim.id, { username: "victim_acct", playerId: 5150 }),
    ).toMatchObject({ ok: false, reason: "chess_account_already_linked" });
  });

  it("does not verify closed accounts, renamed accounts, or an unreachable Chess.com", async () => {
    const u = await eligible();
    const claim = await claimFor(u.id, "closed_user");
    chess.setProfile({
      username: "closed_user",
      player_id: 1,
      location: claim.verification_code,
      status: "closed:fair_play_violations",
    });
    expect(
      await checkProfileCode(client(), { username: "closed_user", code: claim.verification_code }),
    ).toMatchObject({ verified: false, reason: "account_closed" });

    chess.setProfile({ username: "closed_user", player_id: 1, location: claim.verification_code });
    chess.fail(/closed_user/, 301, 1);
    expect(
      await checkProfileCode(client(), { username: "closed_user", code: claim.verification_code }),
    ).toMatchObject({ verified: false, reason: "renamed" });
    chess.fail(/closed_user/, 503, 1);
    expect(
      await checkProfileCode(client(), { username: "closed_user", code: claim.verification_code }),
    ).toMatchObject({ verified: false, reason: "unavailable" });
    chess.fail(/closed_user/, 429, 1);
    expect(
      await checkProfileCode(client(), { username: "closed_user", code: claim.verification_code }),
    ).toMatchObject({ verified: false, reason: "rate_limited" });
    expect(
      (
        await db.admin.query(
          "select count(*)::int as n from public.chess_account_links where user_id = $1",
          [u.id],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it("falls back to administrator review when the automatic check cannot work", async () => {
    const u = await eligible();
    const admin = await db.createUser();
    await db.makeAdmin(admin.id, "verification_admin");
    await claimFor(u.id, "cached_forever");
    chess.setProfile({
      username: "cached_forever",
      player_id: 808,
      location: "stale cached value",
    });
    const review = await db
      .as(u.id)
      .query(
        "select * from public.submit_claim_for_review('The Chess.com cache has not refreshed after two days; I can show the account at the club')",
      );
    expect(review.rows[0]).toMatchObject({ status: "needs_review", method: "admin_review" });
    // Still not linked until a human decides.
    expect(
      (
        await db.admin.query(
          "select count(*)::int as n from public.chess_account_links where user_id = $1",
          [u.id],
        )
      ).rows[0].n,
    ).toBe(0);
    await db
      .as(admin.id)
      .query(
        "select public.admin_review_claim($1, true, 'Checked the account live with the student', 808)",
        [review.rows[0].id],
      );
    expect(
      (
        await db.admin.query(
          "select verification_method, chess_player_id::int as chess_player_id from public.chess_account_links where user_id = $1",
          [u.id],
        )
      ).rows[0],
    ).toEqual({ verification_method: "admin_review", chess_player_id: 808 });
  });
});

describe("rating and profile synchronisation (worker)", () => {
  const stats = {
    chess_rapid: {
      last: { rating: 1612, date: 1_760_000_000, rd: 40 },
      best: { rating: 1700, date: 1_750_000_000 },
      record: { win: 30, loss: 20, draw: 5 },
    },
    chess_blitz: { last: { rating: 1405 }, record: { win: 1, loss: 2, draw: 3 } },
    chess_bullet: {},
    chess960_daily: { last: { rating: 2222 } }, // variants are ignored
  };

  it("maps /stats to per-category ratings and drops variants and empty categories", () => {
    const rows = ratingsFromStats(stats as never);
    expect(rows.map((r) => [r.time_class, r.rating])).toEqual(
      [
        ["blitz", 1405],
        ["rapid", 1612],
      ].sort(),
    );
    expect(rows.find((r) => r.time_class === "rapid")).toMatchObject({
      best_rating: 1700,
      wins: 30,
      losses: 20,
      draws: 5,
    });
    expect(rows.find((r) => r.time_class === "daily")).toBeUndefined();
    expect(ratingsFromStats({ chess_rapid: { last: { rating: 9999 } } } as never)).toEqual([]); // out of range is not stored
  });

  it("refreshes ratings and avatar for due players, one at a time", async () => {
    const p = await db.onboard({ username: "synced_one", playerId: 99001 });
    chess.setProfile({
      username: "synced_one",
      player_id: 99001,
      avatar: "https://images.chesscomfiles.com/uploads/v1/user/99001.png",
    });
    chess.setStats("synced_one", stats);
    // Only this player is due; everyone created by earlier tests in this database is pushed out.
    await db.admin.query(
      "update public.chess_sync_state set next_sync_at = now() + interval '1 day'",
    );
    await db.admin.query(
      "update public.chess_sync_state set next_sync_at = now() - interval '1 minute' where user_id = $1",
      [p.id],
    );
    chess.resetCounters();
    const summary = await runPlayerSync(createPgRpc(db) as never, client(), {
      limit: 10,
      deadline: Date.now() + 20_000,
    });
    expect(summary).toMatchObject({ synced: 1, failed: 0, anomalies: 0 });
    expect(chess.maxConcurrent).toBe(1);
    const rows = (
      await db.admin.query(
        "select time_class, rating from public.chess_ratings where user_id = $1 order by time_class",
        [p.id],
      )
    ).rows;
    expect(rows).toEqual([
      { time_class: "blitz", rating: 1405 },
      { time_class: "rapid", rating: 1612 },
    ]);
    expect(
      (await db.admin.query("select avatar_url from public.profiles where id = $1", [p.id])).rows[0]
        .avatar_url,
    ).toMatch(/99001\.png$/);
  });

  it("records failures and flags identity changes without touching the verified link", async () => {
    const p = await db.onboard({ username: "drifting_one", playerId: 77001 });
    const rpc = createPgRpc(db) as never;
    const player = { user_id: p.id, chess_username: "drifting_one", chess_player_id: 77001 };

    chess.setProfile({ username: "drifting_one", player_id: 77001 });
    chess.setStats("drifting_one", stats);
    chess.fail(/drifting_one/, 503, 99);
    const failed = await syncOnePlayer(
      rpc,
      new ChessComClient({
        userAgent: "t",
        baseUrl: chess.baseUrl,
        minIntervalMs: 0,
        maxRetries: 0,
        sleep: async () => undefined,
      }),
      player,
    );
    expect(failed.ok).toBe(false);
    expect(
      (
        await db.admin.query(
          "select error_count, last_error from public.chess_sync_state where user_id = $1",
          [p.id],
        )
      ).rows[0],
    ).toMatchObject({ error_count: 1, last_error: "server_error (503)" });
    chess.clearFailures();

    // The Chess.com account now reports a different player id under the same name.
    chess.setProfile({ username: "drifting_one", player_id: 11111 });
    const swapped = await syncOnePlayer(rpc, client(), player);
    expect(swapped).toMatchObject({ ok: false, anomaly: "player_id_changed" });
    expect(
      (
        await db.admin.query(
          "select chess_username, chess_player_id::int as chess_player_id from public.chess_account_links where user_id = $1",
          [p.id],
        )
      ).rows[0],
    ).toEqual({ chess_username: "drifting_one", chess_player_id: 77001 });
  });
});
