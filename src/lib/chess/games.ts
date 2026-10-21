import { CHESSCOM_GAME_URL, isTimeClass, type TimeClass } from "@/lib/chess/constants";
import { ChessComGameSchema, type ChessComGame } from "@/lib/chess/schemas";
import { isValidChessUsername, normalizeChessUsername } from "@/lib/chess/username";

/** Result codes Chess.com reports per side that mean the game was drawn. */
const DRAW_CODES = new Set([
  "agreed",
  "repetition",
  "stalemate",
  "insufficient",
  "50move",
  "timevsinsufficient",
]);
/** Result codes that mean that side lost. */
const LOSS_CODES = new Set([
  "checkmated",
  "resigned",
  "timeout",
  "abandoned",
  "lose",
  "kingofthehill",
  "threecheck",
  "bughousepartnerlose",
]);

export type Winner = "white" | "black" | "draw" | "unknown";

/**
 * Winner from the two per-side result codes.
 *
 * Deliberately conservative: only a clear "win" opposite a loss code, or two draw codes,
 * produce an answer. Anything else — missing codes, a code we do not know, contradictory
 * codes — is "unknown", and an unknown result is never counted (it goes to moderator review).
 */
export function deriveWinner(
  whiteResult: string | undefined,
  blackResult: string | undefined,
): Winner {
  const w = whiteResult?.toLowerCase();
  const b = blackResult?.toLowerCase();
  if (!w || !b) return "unknown";
  if (w === "win" && LOSS_CODES.has(b)) return "white";
  if (b === "win" && LOSS_CODES.has(w)) return "black";
  if (DRAW_CODES.has(w) && DRAW_CODES.has(b)) return "draw";
  return "unknown";
}

/** Row shape accepted by `public.import_chess_games`. */
export interface ImportGameRow {
  game_url: string;
  game_uuid: string | null;
  white_username: string;
  black_username: string;
  white_rating: number | null;
  black_rating: number | null;
  white_result: string | null;
  black_result: string | null;
  winner: Winner;
  time_control: string | null;
  time_class: TimeClass | null;
  rules: string;
  rated: boolean | null;
  started_at: string | null;
  ended_at: string;
  archive_month: string;
}

function pgnTag(pgn: string | undefined, tag: string): string | null {
  if (!pgn) return null;
  const m = pgn.match(new RegExp(`^\\[${tag} "([^"]*)"\\]`, "m"));
  return m ? m[1]! : null;
}

/** Game start from the PGN's UTCDate / UTCTime tags, when present and sane. */
export function parseStartedAt(game: ChessComGame, endedAt: Date): string | null {
  if (game.time_class === "daily") return null; // daily games span days; a start bound adds no safety
  const date = pgnTag(game.pgn, "UTCDate");
  const time = pgnTag(game.pgn, "UTCTime");
  if (!date || !time || !/^\d{4}\.\d{2}\.\d{2}$/.test(date) || !/^\d{2}:\d{2}:\d{2}$/.test(time))
    return null;
  const started = new Date(`${date.replaceAll(".", "-")}T${time}Z`);
  if (Number.isNaN(started.getTime())) return null;
  const spanMs = endedAt.getTime() - started.getTime();
  // Must precede the end and be plausible for a live game; otherwise do not trust it.
  if (spanMs < 0 || spanMs > 6 * 3600_000) return null;
  return started.toISOString();
}

export interface NormalizeResult {
  game: ImportGameRow | null;
  /** Why the game was dropped (for diagnostics), when `game` is null. */
  skipped?: string;
}

/** Validates and converts one raw archive entry. Never throws. */
export function normalizeArchiveGame(raw: unknown, archiveMonth: string): NormalizeResult {
  const parsed = ChessComGameSchema.safeParse(raw);
  if (!parsed.success) return { game: null, skipped: "invalid_shape" };
  const g = parsed.data;

  if (!CHESSCOM_GAME_URL.test(g.url)) return { game: null, skipped: "unexpected_url" };
  if (typeof g.end_time !== "number" || g.end_time <= 0)
    return { game: null, skipped: "missing_end_time" };
  const white = normalizeChessUsername(g.white.username);
  const black = normalizeChessUsername(g.black.username);
  if (!isValidChessUsername(white) || !isValidChessUsername(black) || white === black) {
    return { game: null, skipped: "invalid_players" };
  }
  const endedAt = new Date(g.end_time * 1000);
  const uuid = g.uuid && /^[0-9a-f-]{36}$/i.test(g.uuid) ? g.uuid.toLowerCase() : null;

  return {
    game: {
      game_url: g.url,
      game_uuid: uuid,
      white_username: white,
      black_username: black,
      white_rating: g.white.rating !== undefined ? Math.round(g.white.rating) : null,
      black_rating: g.black.rating !== undefined ? Math.round(g.black.rating) : null,
      white_result: g.white.result ?? null,
      black_result: g.black.result ?? null,
      winner: deriveWinner(g.white.result, g.black.result),
      time_control: g.time_control ?? null,
      time_class: isTimeClass(g.time_class) ? g.time_class : null,
      rules: g.rules ?? "chess",
      rated: g.rated ?? null,
      started_at: parseStartedAt(g, endedAt),
      ended_at: endedAt.toISOString(),
      archive_month: archiveMonth,
    },
  };
}

/**
 * Keeps only games played between two linked members (both usernames in `members`).
 * Everything else in an archive is irrelevant to the college and is not stored.
 */
export function filterMemberGames(
  games: ImportGameRow[],
  members: ReadonlySet<string>,
): ImportGameRow[] {
  return games.filter((g) => members.has(g.white_username) && members.has(g.black_username));
}

/** "2026/10"-style archive months from the month of `from` through the month of `to`, inclusive. */
export function monthsBetween(from: Date, to: Date): string[] {
  const months: string[] = [];
  let y = from.getUTCFullYear();
  let m = from.getUTCMonth();
  const endY = to.getUTCFullYear();
  const endM = to.getUTCMonth();
  while ((y < endY || (y === endY && m <= endM)) && months.length < 24) {
    months.push(`${y}/${String(m + 1).padStart(2, "0")}`);
    m++;
    if (m > 11) {
      m = 0;
      y++;
    }
  }
  return months;
}

export function currentMonth(now: Date): string {
  return `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}
