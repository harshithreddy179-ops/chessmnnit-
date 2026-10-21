import { apiRoute, unwrap } from "@/server/api";
import { presenceSchema } from "@/lib/schemas";

export const PATCH = apiRoute(
  { schema: presenceSchema, requireOnboarded: false },
  async ({ ctx, body }) => {
    unwrap(
      await ctx.supabase
        .from("profile_settings")
        .update({ presence_mode: body.presence_mode })
        .eq("user_id", ctx.user.id)
        .select("user_id")
        .single(),
    );
    return { presence_mode: body.presence_mode };
  },
);
