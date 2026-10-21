import { apiRoute, unwrap } from "@/server/api";
import { profileUpdateSchema } from "@/lib/schemas";
import type { Database } from "@/lib/database.types";

type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"];

/** Only the four display fields can be written; the database grants nothing else to clients. */
export const PATCH = apiRoute(
  { schema: profileUpdateSchema, requireOnboarded: false },
  async ({ ctx, body }) => {
    const patch: ProfileUpdate = {};
    if (body.display_name !== undefined) patch.display_name = body.display_name;
    if (body.bio !== undefined) patch.bio = body.bio === "" ? null : body.bio;
    if (body.preferred_time_classes !== undefined)
      patch.preferred_time_classes = body.preferred_time_classes;
    if (body.open_to_challenges !== undefined) patch.open_to_challenges = body.open_to_challenges;
    if (Object.keys(patch).length === 0) return { updated: false };
    unwrap(
      await ctx.supabase.from("profiles").update(patch).eq("id", ctx.user.id).select("id").single(),
    );
    return { updated: true };
  },
);
