import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChessComClient } from "@/lib/chess/client";
import { ratingsFromStats, runPlayerSync, syncOnePlayer } from "@/server/sync/players";
import { startFakeChessCom, type FakeChessCom } from "../helpers/fake-chesscom";
import { createPgRpc } from "../helpers/pg-rpc";
import { createTestDb, type TestDb } from "./helpers";

/**
 * Rating and profile synchronisation against a local stand-in modelled on Chess.com's documented
 * API. Whether the live service matches it is what `npm run chesscom:probe` is for
 * (docs/CHESSCOM_INTEGRATION.md).
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
