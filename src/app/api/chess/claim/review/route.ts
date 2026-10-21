import { apiRoute, unwrap } from "@/server/api";
import { claimReviewSchema } from "@/lib/schemas";

/** Ask a verification administrator to confirm ownership manually. */
export const POST = apiRoute({ schema: claimReviewSchema, requireOnboarded: false }, async ({ ctx, body }) => {
  const claim = unwrap(await ctx.supabase.rpc("submit_claim_for_review", { p_note: body.note }));
  return { id: claim.id, status: claim.status };
});
