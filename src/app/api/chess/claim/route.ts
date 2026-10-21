import { apiRoute, unwrap } from "@/server/api";
import { claimStartSchema } from "@/lib/schemas";
import { startClaim } from "@/server/verification";

/** Start verifying a Chess.com username. The database generates the one-time code. */
export const POST = apiRoute(
  { schema: claimStartSchema, requireOnboarded: false },
  async ({ ctx, body }) => {
    const { claim, accountConfirmed } = await startClaim(ctx, body.username);
    return {
      claim: {
        id: claim.id,
        chess_username: claim.chess_username,
        verification_code: claim.verification_code,
        code_expires_at: claim.code_expires_at,
        status: claim.status,
      },
      accountConfirmed,
    };
  },
);

export const DELETE = apiRoute({ requireOnboarded: false }, async ({ ctx }) => {
  unwrap(await ctx.supabase.rpc("cancel_chess_claim"));
  return { cancelled: true };
});
