import "server-only";

import type { Db } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

export type ChallengeRow = Database["public"]["Tables"]["challenges"]["Row"];
export type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];

export interface ChallengeView extends ChallengeRow {
  direction: "sent" | "received";
  opponentId: string;
  opponentName: string;
  opponentUsername: string;
  timeControlLabel: string;
}

const ACTIVE = [
  "pending",
  "accepted",
  "waiting_for_game",
  "checking_result",
  "needs_review",
] as const;
export const isActiveStatus = (s: string) => (ACTIVE as readonly string[]).includes(s);

/** Challenges the signed-in user takes part in, with their opponent's display name. */
export async function getMyChallenges(
  db: Db,
  userId: string,
  limit = 100,
): Promise<ChallengeView[]> {
  const { data } = await db
    .from("challenges")
    .select("*")
    .or(`challenger_id.eq.${userId},recipient_id.eq.${userId}`)
    .order("created_at", { ascending: false })
    .limit(limit);
  const rows = data ?? [];
  return decorate(db, userId, rows);
}

async function decorate(db: Db, userId: string, rows: ChallengeRow[]): Promise<ChallengeView[]> {
  const ids = [
    ...new Set(
      rows.flatMap((r) => [r.challenger_id, r.recipient_id]).filter((id) => id !== userId),
    ),
  ];
  const [names, controls] = await Promise.all([
    ids.length
      ? db.from("profiles").select("id,display_name").in("id", ids)
      : Promise.resolve({ data: [] as { id: string; display_name: string }[] }),
    db.from("supported_time_controls").select("time_control,label"),
  ]);
  const nameOf = new Map((names.data ?? []).map((p) => [p.id, p.display_name]));
  const labelOf = new Map((controls.data ?? []).map((c) => [c.time_control, c.label]));
  return rows.map((r) => {
    const sent = r.challenger_id === userId;
    const opponentId = sent ? r.recipient_id : r.challenger_id;
    return {
      ...r,
      direction: sent ? "sent" : "received",
      opponentId,
      opponentName: nameOf.get(opponentId) ?? (sent ? r.recipient_username : r.challenger_username),
      opponentUsername: sent ? r.recipient_username : r.challenger_username,
      timeControlLabel: labelOf.get(r.time_control) ?? r.time_control,
    };
  });
}

export async function getChallengeDetail(db: Db, userId: string, id: string) {
  const { data } = await db.from("challenges").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  const [view] = await decorate(db, userId, [data]);
  const [events, attempts, match, disputes] = await Promise.all([
    db.from("challenge_events").select("*").eq("challenge_id", id).order("id"),
    db
      .from("match_sync_attempts")
      .select("id,outcome,candidates,detail,error,attempted_at")
      .eq("challenge_id", id)
      .order("id", { ascending: false })
      .limit(20),
    db.from("college_matches").select("*").eq("challenge_id", id).maybeSingle(),
    db.from("match_disputes").select("*").eq("challenge_id", id).order("created_at"),
  ]);
  return {
    challenge: view!,
    events: events.data ?? [],
    attempts: attempts.data ?? [],
    match: match.data,
    disputes: disputes.data ?? [],
  };
}

export async function getNotifications(db: Db, userId: string, page: number, pageSize = 20) {
  const { data, count } = await db
    .from("notifications")
    .select("*", { count: "exact" })
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  return { rows: data ?? [], total: count ?? 0 };
}

export async function getMyStats(db: Db, userId: string) {
  const [stats, ratings, claim] = await Promise.all([
    db.from("player_stats").select("*").eq("user_id", userId).maybeSingle(),
    db.from("chess_ratings").select("*").eq("user_id", userId),
    db.from("chess_sync_state").select("*").eq("user_id", userId).maybeSingle(),
  ]);
  return { stats: stats.data, ratings: ratings.data ?? [], sync: claim.data };
}
