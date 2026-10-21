import "server-only";

import { ChessComError, type ChessComClient } from "@/lib/chess/client";
import { STATS_KEY_TO_CLASS } from "@/lib/chess/constants";
import type { ChessComStats } from "@/lib/chess/schemas";
import type { Db } from "@/lib/supabase/server";

export interface PlayerToSync {
  user_id: string;
  chess_username: string;
  chess_player_id: number | null;
}

export interface RatingRow {
  time_class: string;
  rating: number;
  best_rating?: number;
  wins: number;
  losses: number;
  draws: number;
  last_game_at?: string;
}

/** Maps /stats categories to rating rows. Only standard-chess categories are kept. */
export function ratingsFromStats(stats: ChessComStats): RatingRow[] {
  const rows: RatingRow[] = [];
  for (const [key, timeClass] of Object.entries(STATS_KEY_TO_CLASS)) {
    const category = (stats as Record<string, unknown>)[key] as ChessComStats["chess_rapid"];
    const rating = category?.last?.rating;
    if (rating === undefined || !Number.isFinite(rating) || rating < 0 || rating > 4000) continue;
    rows.push({
      time_class: timeClass,
      rating: Math.round(rating),
      ...(category?.best?.rating !== undefined && category.best.rating >= 0 && category.best.rating <= 4000
        ? { best_rating: Math.round(category.best.rating) }
        : {}),
      wins: Math.max(0, category?.record?.win ?? 0),
      losses: Math.max(0, category?.record?.loss ?? 0),
      draws: Math.max(0, category?.record?.draw ?? 0),
      ...(category?.last?.date ? { last_game_at: new Date(category.last.date * 1000).toISOString() } : {}),
    });
  }
  return rows;
}

export interface SyncOutcome {
  ok: boolean;
  anomaly?: string | null;
  error?: string;
  /** Chess.com asked us to slow down for longer than we are willing to wait. */
  stop?: boolean;
}

/** Refreshes one player's public profile and per-category ratings. Never changes identity. */
export async function syncOnePlayer(admin: Db, client: Pick<ChessComClient, "getProfile" | "getStats">, player: PlayerToSync): Promise<SyncOutcome> {
  try {
    const profile = await client.getProfile(player.chess_username);
    const closed = profile.status?.toLowerCase().startsWith("closed");
    if (closed) {
      await admin.rpc("record_player_sync", { p_user: player.user_id, p_ok: false, p_error: "chess.com account is closed" });
      return { ok: false, error: "account_closed" };
    }
    const stats = await client.getStats(player.chess_username);
    const { data, error } = await admin.rpc("record_player_sync", {
      p_user: player.user_id,
      p_ok: true,
      p_observed_player_id: profile.player_id,
      p_observed_username: profile.username,
      p_avatar_url: profile.avatar && profile.avatar.startsWith("https://") ? profile.avatar : undefined,
      p_ratings: ratingsFromStats(stats) as never,
    });
    if (error) throw new Error(error.message);
    const result = data as { ok: boolean; anomaly?: string | null };
    return { ok: result.ok, anomaly: result.anomaly ?? null };
  } catch (error) {
    const message = error instanceof ChessComError ? `${error.kind}${error.status ? ` (${error.status})` : ""}` : "unexpected error";
    await admin.rpc("record_player_sync", { p_user: player.user_id, p_ok: false, p_error: message });
    return { ok: false, error: message, stop: error instanceof ChessComError && error.kind === "rate_limited" };
  }
}

export interface PlayerSyncSummary {
  claimed: number;
  synced: number;
  failed: number;
  anomalies: number;
  stoppedEarly: boolean;
}

/**
 * Background job: refresh due players, strictly one at a time, until the time budget is
 * spent. Leased-but-unprocessed rows simply come due again when their lease expires.
 */
export async function runPlayerSync(
  admin: Db,
  client: Pick<ChessComClient, "getProfile" | "getStats">,
  options: { limit: number; deadline: number },
): Promise<PlayerSyncSummary> {
  const summary: PlayerSyncSummary = { claimed: 0, synced: 0, failed: 0, anomalies: 0, stoppedEarly: false };
  const { data, error } = await admin.rpc("claim_players_for_sync", { p_limit: options.limit, p_lease_seconds: 900 });
  if (error) throw new Error(error.message);
  const players = data ?? [];
  summary.claimed = players.length;
  for (const player of players) {
    if (Date.now() > options.deadline) {
      summary.stoppedEarly = true;
      break;
    }
    const outcome = await syncOnePlayer(admin, client, player);
    if (outcome.ok) summary.synced++;
    else {
      summary.failed++;
      if (outcome.anomaly) summary.anomalies++;
    }
    if (outcome.stop) {
      summary.stoppedEarly = true;
      break;
    }
  }
  return summary;
}
