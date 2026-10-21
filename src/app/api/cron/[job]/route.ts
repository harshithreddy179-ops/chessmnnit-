import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { getCronSecret } from "@/lib/env.server";
import { JOB_NAMES, JobConfigError, runJob, type JobName } from "@/server/jobs";

// Scheduled jobs must never be cached or statically rendered, and may run for a while.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * Scheduled-job endpoint, protected by a shared secret (Authorization: Bearer <CRON_SECRET>).
 * Vercel Cron sends exactly that header when CRON_SECRET is set; GitHub Actions / pg_cron / any
 * external scheduler can do the same. Students' browsers play no part in synchronisation.
 */
async function handler(req: NextRequest, ctx: { params: Promise<{ job: string }> }) {
  const secret = getCronSecret();
  if (!secret) {
    return Response.json(
      { ok: false, error: "cron_not_configured" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const presented = req.headers.get("authorization") ?? "";
  // Compare fixed-length digests so the comparison is constant-time regardless of input length.
  const authorised = timingSafeEqual(digest(presented), digest(`Bearer ${secret}`));
  if (!authorised) {
    return Response.json(
      { ok: false, error: "unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const { job } = await ctx.params;
  if (!(JOB_NAMES as readonly string[]).includes(job)) {
    return Response.json({ ok: false, error: "unknown_job", jobs: JOB_NAMES }, { status: 404 });
  }

  try {
    const result = await runJob(job as JobName);
    return Response.json(
      { ok: true, job, ...result },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof JobConfigError) {
      return Response.json(
        { ok: false, error: "not_configured", message: error.message },
        { status: 503 },
      );
    }
    console.error("[cron] job failed:", job, error instanceof Error ? error.message : "unknown");
    return Response.json({ ok: false, error: "job_failed" }, { status: 500 });
  }
}

export { handler as GET, handler as POST };
