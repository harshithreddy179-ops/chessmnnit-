import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { QueryResultRow } from "pg";
import { createTestDb, sqlError, type Player, type TestDb } from "./helpers";

let db: TestDb;
const P: Record<"a" | "b" | "c" | "d" | "e" | "f", Player> = {} as never;
let seq = 8_000_000;

beforeAll(async () => {
  db = await createTestDb();
  for (const k of ["a", "b", "c", "d", "e", "f"] as const) {
    P[k] = await db.onboard({ username: `lb_${k}`, name: `Player ${k.toUpperCase()}` });
  }
  const rate = async (p: Player, cls: string, rating: number, w: number, l: number, d: number) =>
    db.service.query("select public.record_player_sync($1, true, null, null, null, null, $2::jsonb, 3600)", [
      p.id,
      JSON.stringify([{ time_class: cls, rating, wins: w, losses: l, draws: d }]),
    ]);
  await rate(P.a, "rapid", 1800, 10, 5, 1);
  await rate(P.b, "rapid", 1800, 20, 10, 2);
  await rate(P.c, "rapid", 1500, 5, 5, 0);
  await rate(P.f, "rapid", 1500, 5, 5, 0);
  await rate(P.d, "blitz", 2000, 50, 40, 10);

  // a, c each beat e three times; b beats e three times but loses once to f; f also draws e twice.
  const add = async (w: Player, b: Player, r: "white" | "black" | "draw", daysAgo = 1) =>
    db.admin.query(
      `insert into public.college_matches (game_url, white_user_id, black_user_id, white_username, black_username, result, ended_at, source)
       values ($1, $2, $3, $4, $5, $6, now() - ($7 || ' days')::interval - ($8 || ' minutes')::interval, 'automatic')`,
      [`https://www.chess.com/game/live/${seq++}`, w.id, b.id, w.username, b.username, r, String(daysAgo), String(seq % 500)],
    );
  for (const k of ["a", "b", "c"] as const) for (let i = 0; i < 3; i++) await add(P[k], P.e, "white");
  await add(P.b, P.f, "black");
  await add(P.f, P.e, "draw");
  await add(P.e, P.f, "draw");
});
afterAll(async () => {
  await db.close();
});

const board = async (name: string, cls = "rapid", limit = 50, offset = 0) =>
  (await db.anon.query("select * from public.get_leaderboard($1, $2, $3, $4)", [name, cls, limit, offset])).rows;
const names = (rows: QueryResultRow[]): string[] => rows.map((r) => r.chess_username as string);

describe("leaderboards", () => {
  it("ranks the official Chess.com rating per category and never merges categories", async () => {
    // Tie at 1800 is broken by the larger official sample (32 vs 16 games); the 1500 tie falls through to username.
    expect(names(await board("chesscom_rating", "rapid"))).toEqual(["lb_b", "lb_a", "lb_c", "lb_f"]);
    expect(names(await board("chesscom_rating", "blitz"))).toEqual(["lb_d"]);
    expect(names(await board("chesscom_rating", "bullet"))).toEqual([]);
    const rapid = await board("chesscom_rating", "rapid");
    expect(rapid.map((r) => r.chess_rating)).toEqual([1800, 1800, 1500, 1500]);
    expect(rapid[0].ratings_synced_at).toBeTruthy(); // shows when the imported rating was last refreshed
    expect(rapid.map((r) => Number(r.rank))).toEqual([1, 2, 3, 4]);
  });

  it("ranks college wins with deterministic tie-breakers (fewer losses, fewer games, then username)", async () => {
    expect(names(await board("wins"))).toEqual(["lb_a", "lb_c", "lb_b", "lb_f", "lb_e"]);
  });

  it("ranks college match points", async () => {
    const rows = await board("points");
    expect(names(rows)).toEqual(["lb_a", "lb_c", "lb_b", "lb_f", "lb_e"]);
    expect(rows.map((r) => r.points)).toEqual([9, 9, 9, 5, 2]); // win = 3, draw = 1
  });

  it("ranks games played", async () => {
    const rows = await board("games");
    expect(names(rows)).toEqual(["lb_e", "lb_b", "lb_a", "lb_c", "lb_f"]);
    expect(rows[0].games_played).toBe(11);
  });

  it("requires a minimum sample for the win-rate board and exposes the sample size", async () => {
    // Default minimum is 5 completed games: only lb_e (11 games, 0 wins) qualifies.
    const strict = await board("win_rate");
    expect(names(strict)).toEqual(["lb_e"]);
    expect(strict[0].games_played).toBe(11);

    await db.admin.query("update public.app_settings set value = '3'::jsonb where key = 'min_games_for_win_rate'");
    const relaxed = await board("win_rate");
    expect(names(relaxed)).toEqual(["lb_a", "lb_c", "lb_b", "lb_f", "lb_e"]);
    expect(relaxed.map((r) => Number(r.win_rate))).toEqual([1, 1, 0.75, 0.33333, 0]);
    expect(relaxed.map((r) => r.games_played)).toEqual([3, 3, 4, 3, 11]);
    await db.admin.query("update public.app_settings set value = '5'::jsonb where key = 'min_games_for_win_rate'");
  });

  it("ranks Elo derived from college matches, highest first", async () => {
    const rows = await board("elo");
    const elos = rows.map((r) => Number(r.elo));
    expect([...elos].sort((x, y) => y - x)).toEqual(elos);
    expect(rows.at(-1)?.chess_username).toBe("lb_e"); // lost nine games
  });

  it("ranks recent activity from the last 30 days only", async () => {
    // Age one of lb_a's wins out of the 30-day window.
    await db.admin.query(
      `update public.college_matches set ended_at = now() - interval '45 days'
        where id = (select id from public.college_matches where white_username = 'lb_a' limit 1)`,
    );
    const rows = await board("activity");
    const counted = Object.fromEntries(rows.map((r) => [r.chess_username, r.matches_30d]));
    expect(counted).toMatchObject({ lb_e: 10, lb_b: 4, lb_c: 3, lb_f: 3, lb_a: 2 });
    expect(names(rows)[0]).toBe("lb_e");
    expect(rows.every((r, i) => i === 0 || rows[i - 1].matches_30d >= r.matches_30d)).toBe(true);
  });

  it("paginates server-side with a stable total and continuous ranks", async () => {
    const first = await board("chesscom_rating", "rapid", 2, 0);
    const second = await board("chesscom_rating", "rapid", 2, 2);
    expect(names(first)).toEqual(["lb_b", "lb_a"]);
    expect(names(second)).toEqual(["lb_c", "lb_f"]);
    expect(second.map((r) => Number(r.rank))).toEqual([3, 4]);
    expect(Number(first[0].total_count)).toBe(4);
    expect(Number(second[0].total_count)).toBe(4);
  });

  it("is deterministic and rejects unknown boards", async () => {
    expect(await board("wins")).toEqual(await board("wins"));
    expect((await sqlError(db.anon.query("select * from public.get_leaderboard('everything', 'rapid')"))).code).toBe("22023");
    // Limits are clamped, never trusted.
    expect((await board("games", "rapid", 100_000)).length).toBeLessThanOrEqual(100);
  });

  it("hides demo players unless demo mode is explicitly enabled", async () => {
    await db.admin.query("update public.profiles set is_demo = true where id = $1", [P.f.id]);
    expect(names(await board("chesscom_rating", "rapid"))).not.toContain("lb_f");
    expect(names((await db.anon.query("select chess_username from public.get_player_directory(null, 'rapid', null, null, null, false, 'name', 100, 0)")).rows)).not.toContain("lb_f");
    await db.admin.query("update public.app_settings set value = 'true'::jsonb where key = 'include_demo_data'");
    expect(names(await board("chesscom_rating", "rapid"))).toContain("lb_f");
    await db.admin.query("update public.app_settings set value = 'false'::jsonb where key = 'include_demo_data'");
    await db.admin.query("update public.profiles set is_demo = false where id = $1", [P.f.id]);
  });
});

describe("player directory", () => {
  const dir = async (args: unknown[] = []) =>
    (await db.anon.query("select * from public.get_player_directory($1, $2, $3, $4, $5, $6, $7, $8, $9)", [
      args[0] ?? null, args[1] ?? "rapid", args[2] ?? null, args[3] ?? null, args[4] ?? null, args[5] ?? false, args[6] ?? "rating", args[7] ?? 50, args[8] ?? 0,
    ])).rows;

  it("searches by display name or username, escaping wildcard characters", async () => {
    expect(names(await dir(["player c"]))).toEqual(["lb_c"]);
    expect(names(await dir(["LB_D"]))).toEqual(["lb_d"]);
    expect(await dir(["%"])).toHaveLength(0);
    expect(await dir(["lb%a"])).toHaveLength(0); // an unescaped % would match "lb_a"
    expect(names(await dir(["lb_"]))).toHaveLength(6); // a literal underscore does match
    expect(await dir(["' or 1=1 --"])).toHaveLength(0);
  });

  it("filters by rating range within one category", async () => {
    // Directory ties are broken by username (the official-sample tie-break is leaderboard-only).
    expect(names(await dir([null, "rapid", 1600, 2000]))).toEqual(["lb_a", "lb_b"]);
    expect(names(await dir([null, "rapid", null, 1500]))).toEqual(["lb_c", "lb_f"]);
    expect(names(await dir([null, "blitz", 1900, null]))).toEqual(["lb_d"]);
  });

  it("filters by preferred time control and challenge availability", async () => {
    await db.as(P.a.id).query("update public.profiles set preferred_time_classes = '{rapid,blitz}' where id = $1", [P.a.id]);
    await db.as(P.b.id).query("update public.profiles set open_to_challenges = false where id = $1", [P.b.id]);
    expect(names(await dir([null, "rapid", null, null, "blitz"]))).toEqual(["lb_a"]);
    expect(names(await dir([null, "rapid", null, null, null, true]))).not.toContain("lb_b");
  });

  it("sorts and paginates without ever shipping the full table", async () => {
    expect(names(await dir([null, "rapid", null, null, null, false, "name", 3, 0]))).toEqual(["lb_a", "lb_b", "lb_c"]);
    const page = await dir([null, "rapid", null, null, null, false, "name", 2, 4]);
    expect(page).toHaveLength(2);
    expect(Number(page[0].total_count)).toBe(6);
    expect((await sqlError(db.anon.query("select * from public.get_player_directory(null, 'rapid', null, null, null, false, 'drop table')"))).code).toBe("22023");
  });
});

describe("public match history", () => {
  it("lists verified matches with filters by player and outcome", async () => {
    const all = (await db.anon.query("select * from public.get_recent_matches(50, 0)")).rows;
    expect(all).toHaveLength(12);
    expect(Number(all[0].total_count)).toBe(12);
    expect(all.every((m, i) => i === 0 || new Date(all[i - 1].ended_at) >= new Date(m.ended_at))).toBe(true);

    const wins = (await db.anon.query("select * from public.get_recent_matches(50, 0, null, 'lb_f', 'win')")).rows;
    expect(wins).toHaveLength(1);
    expect(wins[0]).toMatchObject({ white_username: "lb_b", black_username: "lb_f", result: "black" });
    const draws = (await db.anon.query("select * from public.get_recent_matches(50, 0, null, 'lb_f', 'draw')")).rows;
    expect(draws).toHaveLength(2);
    expect((await sqlError(db.anon.query("select * from public.get_recent_matches(10, 0, null, null, 'win')"))).code).toBe("22023");
    expect(wins[0].white_display_name).toBe("Player B");
  });

  it("summarises only real, public data", async () => {
    const s = (await db.anon.query("select public.get_public_summary() as s")).rows[0].s;
    expect(s).toMatchObject({ verified_players: 6, verified_matches: 12 });
    expect(s.last_match_at).toBeTruthy();
  });
});
