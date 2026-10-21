import "server-only";

import { createSupabaseAdminClient, type Db } from "@/lib/supabase/server";
import { getChessClient } from "@/server/chess";
import { runChallengeSync } from "@/server/sync/challenges";
import { runPlayerSync } from "@/server/sync/players";
import { createSupabaseSyncStore } from "@/server/sync/supabase-store";

export const JOB_NAMES = ["run-all", "sync-challenges", "sync-players", "expire-challenges", "housekeeping"] as const;
export type JobName = (typeof JOB_NAMES)[number];

export class JobConfigError extends Error {}

/** Leave headroom below the platform's function time limit (see `maxDuration` on the route). */
export const DEFAULT_BUDGET_MS = 50_000;

async function execute(admin: Db, name: Exclude<JobName, "run-all">, deadline: number): Promise<Record<string, unknown>> {
  switch (name) {
    case "expire-challenges": {
      const { data, error } = await admin.rpc("expire_stale_challenges");
      if (error) throw new Error(error.message);
      return { expired: data ?? 0 };
    }
    case "sync-challenges":
      return { ...(await runChallengeSync(createSupabaseSyncStore(admin), getChessClient(), { limit: 50, deadline })) };
    case "sync-players":
      return { ...(await runPlayerSync(admin, getChessClient(), { limit: 40, deadline })) };
    case "housekeeping": {
      const { data, error } = await admin.rpc("run_housekeeping");
      if (error) throw new Error(error.message);
      return (data ?? {}) as Record<string, unknown>;
    }
  }
}

/**
 * Runs a scheduled job and records it in `job_runs` (visible to administrators).
 * `run-all` executes the jobs in priority order within one shared time budget.
 */
export async function runJob(name: JobName, budgetMs = DEFAULT_BUDGET_MS) {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new JobConfigError("The Supabase service key is not configured.");
  const deadline = Date.now() + budgetMs;

  const started = await admin.rpc("start_job_run", { p_job: name });
  const runId = started.data as number | null;
  const finish = async (status: "ok" | "partial" | "error", stats: Record<string, unknown>, error?: string) => {
    if (runId !== null) {
      await admin.rpc("finish_job_run", { p_id: runId, p_status: status, p_stats: stats as never, p_error: error });
    }
  };

  try {
    let stats: Record<string, unknown>;
    if (name === "run-all") {
      stats = {};
      for (const step of ["expire-challenges", "sync-challenges", "sync-players", "housekeeping"] as const) {
        stats[step] = await execute(admin, step, deadline);
      }
    } else {
      stats = await execute(admin, name, deadline);
    }
    const partial = JSON.stringify(stats).includes('"stoppedEarly":true');
    await finish(partial ? "partial" : "ok", stats);
    return { status: partial ? "partial" : "ok", stats };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    await finish("error", {}, message);
    throw error;
  }
}
