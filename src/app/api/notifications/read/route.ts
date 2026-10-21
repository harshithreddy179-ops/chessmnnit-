import { apiRoute, unwrap } from "@/server/api";
import { notificationsReadSchema } from "@/lib/schemas";

export const POST = apiRoute({ schema: notificationsReadSchema, requireOnboarded: false }, async ({ ctx, body }) => {
  const now = new Date().toISOString();
  let query = ctx.supabase.from("notifications").update({ read_at: now }).eq("user_id", ctx.user.id).is("read_at", null);
  if (body.ids?.length) query = query.in("id", body.ids);
  else if (!body.all) return { updated: 0 };
  const { error } = await query;
  unwrap({ data: true, error });
  return { updated: true };
});
