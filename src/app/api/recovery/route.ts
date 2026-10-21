import { apiRoute, unwrap } from "@/server/api";
import { recoverySchema } from "@/lib/schemas";
import { parseChessUsername } from "@/lib/chess/username";
import { ApiError } from "@/server/api";

/** Ask administrators to unlink / reassign a Chess.com username. Never changes anything by itself. */
export const POST = apiRoute({ schema: recoverySchema, requireOnboarded: false }, async ({ ctx, body }) => {
  const username = parseChessUsername(body.username);
  if (!username) throw new ApiError(400, "invalid_username", "Enter a valid Chess.com username.");
  const row = unwrap(await ctx.supabase.rpc("request_account_recovery", { p_kind: body.kind, p_username: username, p_reason: body.reason }));
  return { id: row.id, status: row.status };
});
