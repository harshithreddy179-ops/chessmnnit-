import { ApiError, apiRoute, unwrap } from "@/server/api";
import { challengeActionSchema, uuid } from "@/lib/schemas";

const STATUS = { accept: "accepted", decline: "declined", cancel: "cancelled" } as const;

/**
 * Accept / decline (recipient) or cancel (challenger). Which of these is allowed for whom is
 * enforced by RLS + the BEFORE UPDATE trigger, not by this route.
 */
export const PATCH = apiRoute(
  { schema: challengeActionSchema, requireOnboarded: true },
  async ({ ctx, body, params }) => {
    const id = uuid.safeParse(params.id);
    if (!id.success) throw new ApiError(400, "invalid_id", "Invalid challenge.");
    const { data, error } = await ctx.supabase
      .from("challenges")
      .update({ status: STATUS[body.action] })
      .eq("id", id.data)
      .select("id,status")
      .maybeSingle();
    const row = unwrap({ data, error });
    // RLS hides rows the caller is not part of, which surfaces as "no row updated".
    if (!row) throw new ApiError(404, "not_found", "That challenge could not be found.");
    return row;
  },
);
