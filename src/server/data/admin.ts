import "server-only";

import type { Db } from "@/lib/supabase/server";

/** Admin list queries run through the signed-in admin's session, so RLS decides what they can read. */
export async function getOverview(db: Db) {
  const { data, error } = await db.rpc("admin_overview");
  if (error) throw new Error(error.message);
  return data as {
    players: Record<string, number>;
    queues: Record<string, number>;
    challenges: { created_7d: number; by_status: Record<string, number> };
    matches: Record<string, number>;
    sync: {
      players_with_errors: number;
      players_never_synced: number;
      last_runs: { job: string; status: string; started_at: string; finished_at: string | null }[];
    };
  };
}

export async function nameMap(db: Db, ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map<string, string>();
  const { data } = await db.from("profiles").select("id,display_name").in("id", unique);
  return new Map((data ?? []).map((p) => [p.id, p.display_name]));
}
