import { apiRoute, unwrap } from "@/server/api";

export const POST = apiRoute({ requireOnboarded: false }, async ({ ctx }) => {
  const completedAt = unwrap(await ctx.supabase.rpc("complete_onboarding"));
  return { completed_at: completedAt };
});
