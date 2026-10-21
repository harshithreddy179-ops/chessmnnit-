import { ApiError, apiRoute, unwrap } from "@/server/api";
import { disputeSchema, uuid } from "@/lib/schemas";

export const POST = apiRoute(
  { schema: disputeSchema, requireOnboarded: true },
  async ({ ctx, body, params }) => {
    const id = uuid.safeParse(params.id);
    if (!id.success) throw new ApiError(400, "invalid_id", "Invalid challenge.");
    const row = unwrap(
      await ctx.supabase.rpc("open_match_dispute", {
        p_challenge_id: id.data,
        p_reason: body.reason,
        p_game_url: body.game_url,
        p_result: body.proposed_result,
      }),
    );
    return { id: row.id, status: row.status };
  },
);
