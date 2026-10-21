import { apiRoute, unwrap } from "@/server/api";

/** Re-checks the signed-in user's verified Google email against the admin allowlist. Idempotent. */
export const POST = apiRoute({ requireOnboarded: false }, async ({ ctx }) => {
  const status = unwrap(await ctx.supabase.rpc("claim_eligibility"));
  return { eligibility_status: status };
});
