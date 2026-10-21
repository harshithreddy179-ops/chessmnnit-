import { describe, expect, it } from "vitest";
import {
  currentMonth,
  deriveWinner,
  filterMemberGames,
  monthsBetween,
  normalizeArchiveGame,
} from "@/lib/chess/games";
import { parseChessUsername } from "@/lib/chess/username";

// Fixtures follow the documented shape of /pub/player/{username}/games/{YYYY}/{MM}.
// They were written from the documentation, not captured from the live API (the build
// environment has no route to api.chess.com).
const pgn = (extra = "") =>
  `[Event "Live Chess"]\n[Site "Chess.com"]\n[White "Alice_S"]\n[Black "bob_s"]\n[Result "1-0"]\n[UTCDate "2026.10.20"]\n[UTCTime "12:00:00"]\n${extra}\n1. e4 e5 1-0`;

const rawGame = (over: Record<string, unknown> = {}) => ({
  url: "https://www.chess.com/game/live/123456789",
  uuid: "11111111-2222-3333-4444-555555555555",
  pgn: pgn(),
  time_control: "600",
  time_class: "rapid",
  rules: "chess",
  rated: true,
  end_time: Date.UTC(2026, 9, 20, 12, 10, 0) / 1000,
  white: { username: "Alice_S", rating: 1511, result: "win", uuid: "a" },
  black: { username: "Bob_S", rating: 1498, result: "resigned", uuid: "b" },
  ...over,
});

describe("deriveWinner", () => {
  it.each([
    ["win", "resigned", "white"],
    ["win", "checkmated", "white"],
    ["win", "timeout", "white"],
    ["win", "abandoned", "white"],
    ["checkmated", "win", "black"],
    ["timeout", "win", "black"],
    ["agreed", "agreed", "draw"],
    ["repetition", "repetition", "draw"],
    ["stalemate", "stalemate", "draw"],
    ["insufficient", "timevsinsufficient", "draw"],
    ["50move", "50move", "draw"],
  ])("%s vs %s -> %s", (w, b, expected) => {
    expect(deriveWinner(w, b)).toBe(expected);
  });

  it("never invents a result from missing, unknown or contradictory codes", () => {
    expect(deriveWinner(undefined, "resigned")).toBe("unknown");
    expect(deriveWinner("win", undefined)).toBe("unknown");
    expect(deriveWinner("win", "win")).toBe("unknown");
    expect(deriveWinner("win", "agreed")).toBe("unknown"); // winner opposite a draw code is inconsistent
    expect(deriveWinner("agreed", "resigned")).toBe("unknown");
    expect(deriveWinner("mystery", "resigned")).toBe("unknown");
    expect(deriveWinner("", "")).toBe("unknown");
  });

  it("is case-insensitive", () => {
    expect(deriveWinner("WIN", "Resigned")).toBe("white");
  });
});

describe("normalizeArchiveGame", () => {
  it("normalises a standard game", () => {
    const { game } = normalizeArchiveGame(rawGame(), "2026/10");
    expect(game).toMatchObject({
      game_url: "https://www.chess.com/game/live/123456789",
      game_uuid: "11111111-2222-3333-4444-555555555555",
      white_username: "alice_s",
      black_username: "bob_s",
      white_rating: 1511,
      winner: "white",
      time_control: "600",
      time_class: "rapid",
      rules: "chess",
      rated: true,
      ended_at: "2026-10-20T12:10:00.000Z",
      started_at: "2026-10-20T12:00:00.000Z",
      archive_month: "2026/10",
    });
  });

  it("drops entries it cannot trust, with a reason, without throwing", () => {
    expect(normalizeArchiveGame(null, "2026/10").skipped).toBe("invalid_shape");
    expect(normalizeArchiveGame({ url: 5 }, "2026/10").skipped).toBe("invalid_shape");
    expect(
      normalizeArchiveGame(rawGame({ url: "https://evil.example/game/live/1" }), "2026/10").skipped,
    ).toBe("unexpected_url");
    expect(normalizeArchiveGame(rawGame({ end_time: undefined }), "2026/10").skipped).toBe(
      "missing_end_time",
    );
    expect(
      normalizeArchiveGame(rawGame({ white: { username: "bad name!" } }), "2026/10").skipped,
    ).toBe("invalid_players");
    expect(
      normalizeArchiveGame(rawGame({ black: { username: "ALICE_S", result: "x" } }), "2026/10")
        .skipped,
    ).toBe("invalid_players");
  });

  it("keeps variants and unknown time classes visible instead of coercing them", () => {
    expect(normalizeArchiveGame(rawGame({ rules: "chess960" }), "2026/10").game?.rules).toBe(
      "chess960",
    );
    expect(
      normalizeArchiveGame(rawGame({ time_class: "ultra" }), "2026/10").game?.time_class,
    ).toBeNull();
    expect(
      normalizeArchiveGame(rawGame({ time_control: undefined }), "2026/10").game?.time_control,
    ).toBeNull();
  });

  it("only trusts a PGN start time that is plausible", () => {
    const ended = Date.UTC(2026, 9, 20, 12, 10, 0) / 1000;
    expect(
      normalizeArchiveGame(rawGame({ pgn: pgn().replace("12:00:00", "14:00:00") }), "2026/10").game
        ?.started_at,
    ).toBeNull(); // after the end
    expect(
      normalizeArchiveGame(rawGame({ pgn: '[Event "x"]\n1. e4' }), "2026/10").game?.started_at,
    ).toBeNull();
    expect(
      normalizeArchiveGame(rawGame({ time_class: "daily", end_time: ended }), "2026/10").game
        ?.started_at,
    ).toBeNull();
    expect(
      normalizeArchiveGame(rawGame({ pgn: pgn().replace("2026.10.20", "2026.10.01") }), "2026/10")
        .game?.started_at,
    ).toBeNull(); // 19 days: implausible for a live game
  });

  it("ignores a malformed uuid rather than storing it", () => {
    expect(
      normalizeArchiveGame(rawGame({ uuid: "not-a-uuid" }), "2026/10").game?.game_uuid,
    ).toBeNull();
  });
});

describe("archive helpers", () => {
  it("keeps only games between two linked members", () => {
    const mk = (w: string, b: string) =>
      normalizeArchiveGame(
        rawGame({
          white: { username: w, result: "win" },
          black: { username: b, result: "resigned" },
        }),
        "2026/10",
      ).game!;
    const members = new Set(["alice_s", "bob_s"]);
    const kept = filterMemberGames(
      [mk("alice_s", "bob_s"), mk("alice_s", "stranger_x"), mk("stranger_x", "other_y")],
      members,
    );
    expect(kept).toHaveLength(1);
  });

  it("lists every archive month in a range, across year boundaries", () => {
    expect(
      monthsBetween(new Date("2026-10-31T23:00:00Z"), new Date("2026-10-31T23:30:00Z")),
    ).toEqual(["2026/10"]);
    expect(
      monthsBetween(new Date("2026-11-20T00:00:00Z"), new Date("2027-02-02T00:00:00Z")),
    ).toEqual(["2026/11", "2026/12", "2027/01", "2027/02"]);
    expect(
      monthsBetween(new Date("2026-12-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z")),
    ).toEqual([]);
    expect(currentMonth(new Date("2026-03-09T00:00:00Z"))).toBe("2026/03");
  });
});

describe("parseChessUsername", () => {
  it("accepts usernames and pasted profile links, normalising case", () => {
    expect(parseChessUsername("  Magnus_C  ")).toBe("magnus_c");
    expect(parseChessUsername("https://www.chess.com/member/Magnus_C")).toBe("magnus_c");
    expect(parseChessUsername("chess.com/member/magnus-c/")).toBe("magnus-c");
    expect(parseChessUsername("https://www.chess.com/member/Magnus_C?tab=games")).toBe("magnus_c");
  });
  it("rejects anything that is not a valid username", () => {
    for (const bad of [
      "",
      "ab",
      "has space",
      "x".repeat(26),
      "semi;colon",
      "https://evil.example/member/abc",
      "../etc/passwd",
      "<script>",
    ]) {
      expect(parseChessUsername(bad)).toBeNull();
    }
  });
});
