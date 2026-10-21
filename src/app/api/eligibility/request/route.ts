import { apiRoute, unwrap } from "@/server/api";
import { eligibilityRequestSchema } from "@/lib/schemas";

export const POST = apiRoute({ schema: eligibilityRequestSchema, requireOnboarded: false }, async ({ ctx, body }) => {
  const row = unwrap(await ctx.supabase.rpc("request_eligibility_review", { p_identifier: body.identifier, p_note: body.note }));
  return { id: row.id, status: row.status };
});
