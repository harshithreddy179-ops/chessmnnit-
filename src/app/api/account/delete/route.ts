import { ApiError, apiRoute, unwrap } from "@/server/api";
import { deleteAccountSchema } from "@/lib/schemas";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

/**
 * Self-service account deletion. Deleting the Supabase Auth user cascades to the profile,
 * link, ratings, challenges and notifications. Verified match records are kept without the
 * deleted player's identity, so the opponent's history is not rewritten (docs/PRIVACY.md).
 */
export const POST = apiRoute(
  { schema: deleteAccountSchema, requireOnboarded: false },
  async ({ ctx }) => {
    const admin = createSupabaseAdminClient();
    if (!admin) {
      throw new ApiError(
        503,
        "not_configured",
        "Account deletion is awaiting server configuration. Contact an administrator.",
      );
    }
    if (ctx.roles.includes("super_admin")) {
      const { count } = await admin
        .from("admin_roles")
        .select("user_id", { count: "exact", head: true })
        .eq("role", "super_admin");
      if ((count ?? 0) <= 1) {
        throw new ApiError(
          409,
          "last_super_admin",
          "You are the only super admin. Hand over the role before deleting your account.",
        );
      }
    }
    const { error } = await admin.auth.admin.deleteUser(ctx.user.id);
    unwrap({ data: true, error: error ? { message: error.message } : null });
    await ctx.supabase.auth.signOut().catch(() => undefined);
    return { deleted: true };
  },
);
