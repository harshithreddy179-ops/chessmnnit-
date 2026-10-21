import "server-only";

import { unstable_cache } from "next/cache";
import { createSupabasePublicClient } from "@/lib/supabase/server";
import type { TimeClass } from "@/lib/chess/constants";
import type { Database } from "@/lib/database.types";

export type LeaderboardRow = Database["public"]["Functions"]["get_leaderboard"]["Returns"][number];
export type DirectoryRow = Database["public"]["Functions"]["get_player_directory"]["Returns"][number];
export type MatchRow = Database["public"]["Functions"]["get_recent_matches"]["Returns"][number];

export const LEADERBOARDS = [
  { id: "chesscom_rating", label: "Chess.com rating", blurb: "Imported official rating for one category. Never mixed across Bullet, Blitz, Rapid or Daily.", needsClass: true },
  { id: "points", label: "College points", blurb: "3 points for a win, 1 for a draw, 0 for a loss, across verified college matches.", needsClass: false },
  { id: "wins", label: "College wins", blurb: "Verified college match wins. Ties: fewer losses, then fewer games.", needsClass: false },
  { id: "elo", label: "College Elo", blurb: "Elo computed only from verified college matches (start 1000, K = 32).", needsClass: false },
  { id: "games", label: "Games played", blurb: "Verified college matches played.", needsClass: false },
  { id: "win_rate", label: "Win rate", blurb: "Wins ÷ games played (draws count as games). Players need a minimum number of games.", needsClass: false },
  { id: "activity", label: "Recent activity", blurb: "Verified college matches in the last 30 days.", needsClass: false },
] as const;
export type BoardId = (typeof LEADERBOARDS)[number]["id"];

async function fetchLanding() {
  const db = createSupabasePublicClient();
  if (!db) return null;
  const [summary, byRating, byPoints, recent, settings] = await Promise.all([
    db.rpc("get_public_summary"),
    db.rpc("get_leaderboard", { p_board: "chesscom_rating", p_time_class: "rapid", p_limit: 5, p_offset: 0 }),
    db.rpc("get_leaderboard", { p_board: "points", p_limit: 5, p_offset: 0 }),
    db.rpc("get_recent_matches", { p_limit: 5, p_offset: 0 }),
    db.from("app_settings").select("key,value").in("key", ["include_demo_data"]),
  ]);
  return {
    summary: (summary.data ?? null) as { verified_players: number; verified_matches: number; matches_30d: number; last_match_at: string | null } | null,
    byRating: byRating.data ?? [],
    byPoints: byPoints.data ?? [],
    recent: recent.data ?? [],
    demo: (settings.data ?? []).some((s) => s.key === "include_demo_data" && s.value === true),
    error: Boolean(summary.error || byRating.error || byPoints.error || recent.error),
  };
}

/** Public landing data: identical for every visitor, so it is cached for a minute. */
export const getLandingData = unstable_cache(fetchLanding, ["landing-v1"], { revalidate: 60, tags: ["public-data"] });

export interface PageParams {
  page: number;
  pageSize: number;
}

export async function getLeaderboard(board: BoardId, timeClass: TimeClass, { page, pageSize }: PageParams) {
  const db = createSupabasePublicClient();
  if (!db) return { rows: [] as LeaderboardRow[], total: 0, configured: false, error: false };
  const { data, error } = await db.rpc("get_leaderboard", {
    p_board: board, p_time_class: timeClass, p_limit: pageSize, p_offset: (page - 1) * pageSize,
  });
  const rows = data ?? [];
  return { rows, total: Number(rows[0]?.total_count ?? 0), configured: true, error: Boolean(error) };
}

export interface DirectoryQuery extends PageParams {
  search?: string;
  timeClass: TimeClass;
  minRating?: number;
  maxRating?: number;
  preferred?: TimeClass;
  openOnly: boolean;
  sort: "rating" | "wins" | "games" | "recent" | "name";
}

export async function getDirectory(q: DirectoryQuery) {
  const db = createSupabasePublicClient();
  if (!db) return { rows: [] as DirectoryRow[], total: 0, configured: false, error: false };
  const { data, error } = await db.rpc("get_player_directory", {
    p_search: q.search, p_time_class: q.timeClass, p_min_rating: q.minRating, p_max_rating: q.maxRating,
    p_preferred: q.preferred, p_open_only: q.openOnly, p_sort: q.sort, p_limit: q.pageSize, p_offset: (q.page - 1) * q.pageSize,
  });
  const rows = data ?? [];
  return { rows, total: Number(rows[0]?.total_count ?? 0), configured: true, error: Boolean(error) };
}

export async function getMatches(opts: PageParams & { timeClass?: TimeClass; username?: string; outcome?: "win" | "loss" | "draw" }) {
  const db = createSupabasePublicClient();
  if (!db) return { rows: [] as MatchRow[], total: 0, configured: false, error: false };
  const { data, error } = await db.rpc("get_recent_matches", {
    p_limit: opts.pageSize, p_offset: (opts.page - 1) * opts.pageSize, p_time_class: opts.timeClass, p_username: opts.username, p_outcome: opts.outcome,
  });
  const rows = data ?? [];
  return { rows, total: Number(rows[0]?.total_count ?? 0), configured: true, error: Boolean(error) };
}

export async function getPublicSettings() {
  const db = createSupabasePublicClient();
  if (!db) return {} as Record<string, unknown>;
  const { data } = await db.from("app_settings").select("key,value");
  return Object.fromEntries((data ?? []).map((s) => [s.key, s.value]));
}

export async function getTimeControls() {
  const db = createSupabasePublicClient();
  if (!db) return [];
  const { data } = await db.from("supported_time_controls").select("*").eq("active", true).order("sort_order");
  return data ?? [];
}

export async function getPlayerByUsername(username: string) {
  const db = createSupabasePublicClient();
  if (!db) return null;
  const { data: link } = await db.from("chess_account_links").select("*").eq("chess_username", username).maybeSingle();
  if (!link) return null;
  const [profile, ratings, stats, history] = await Promise.all([
    db.from("profiles").select("*").eq("id", link.user_id).maybeSingle(),
    db.from("chess_ratings").select("*").eq("user_id", link.user_id),
    db.from("player_stats").select("*").eq("user_id", link.user_id).maybeSingle(),
    db.from("chess_rating_history").select("time_class,rating,observed_at").eq("user_id", link.user_id).order("observed_at").limit(500),
  ]);
  if (!profile.data) return null;
  return { link, profile: profile.data, ratings: ratings.data ?? [], stats: stats.data, history: history.data ?? [] };
}
