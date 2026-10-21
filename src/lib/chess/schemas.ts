import { z } from "zod";

/**
 * Zod schemas for the Chess.com published-data API.
 *
 * They are intentionally lenient: every field is optional unless this app cannot function
 * without it, unknown fields are tolerated, and malformed individual games are skipped
 * (see games.ts) instead of failing a whole archive. Shapes follow
 * https://www.chess.com/news/view/published-data-api.
 */
const num = z.number().finite();

export const ChessComProfileSchema = z.looseObject({
  username: z.string().min(1),
  player_id: num.int().optional(),
  url: z.string().optional(),
  name: z.string().optional(),
  location: z.string().optional(),
  avatar: z.string().optional(),
  country: z.string().optional(),
  title: z.string().optional(),
  status: z.string().optional(), // e.g. "basic", "premium", "closed", "closed:fair_play_violations"
  joined: num.optional(),
  last_online: num.optional(),
});
export type ChessComProfile = z.infer<typeof ChessComProfileSchema>;

const CategoryStatsSchema = z.looseObject({
  last: z.looseObject({ rating: num.int(), date: num.optional(), rd: num.optional() }).optional(),
  best: z
    .looseObject({ rating: num.int(), date: num.optional(), game: z.string().optional() })
    .optional(),
  record: z
    .looseObject({
      win: num.int().optional(),
      loss: num.int().optional(),
      draw: num.int().optional(),
    })
    .optional(),
});

export const ChessComStatsSchema = z.looseObject({
  chess_daily: CategoryStatsSchema.optional(),
  chess_rapid: CategoryStatsSchema.optional(),
  chess_blitz: CategoryStatsSchema.optional(),
  chess_bullet: CategoryStatsSchema.optional(),
});
export type ChessComStats = z.infer<typeof ChessComStatsSchema>;

export const ChessComArchiveIndexSchema = z.looseObject({ archives: z.array(z.string()) });

const GamePlayerSchema = z.looseObject({
  username: z.string().min(1),
  result: z.string().optional(),
  rating: num.optional(),
  uuid: z.string().optional(),
});

export const ChessComGameSchema = z.looseObject({
  url: z.string().min(1),
  uuid: z.string().optional(),
  pgn: z.string().optional(),
  time_control: z.string().optional(),
  time_class: z.string().optional(),
  rules: z.string().optional(),
  rated: z.boolean().optional(),
  end_time: num.optional(),
  white: GamePlayerSchema,
  black: GamePlayerSchema,
});
export type ChessComGame = z.infer<typeof ChessComGameSchema>;

/** Envelope only; individual games are validated one by one so one bad game cannot hide the rest. */
export const ChessComMonthlyArchiveSchema = z.looseObject({ games: z.array(z.unknown()) });
