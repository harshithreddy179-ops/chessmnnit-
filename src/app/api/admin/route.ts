import { ApiError, apiRoute, unwrap } from "@/server/api";
import { adminActionSchema, type AdminAction } from "@/lib/schemas";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { getChessClient } from "@/server/chess";
import { refreshArchives } from "@/server/sync/challenges";
import { createSupabaseSyncStore } from "@/server/sync/supabase-store";
import type { AppContext } from "@/server/auth";
import type { Json } from "@/lib/database.types";

/**
 * Administrator actions. This route only validates input and prepares trusted context (for
 * example reading a player id from Chess.com). WHO may do WHAT is decided inside each database
 * function (`app_private.require_role`), which also writes the audit entry in the same
 * transaction. A caller without the role gets a 403 from the database even if they craft the
 * request by hand.
 */
export const POST = apiRoute({ schema: adminActionSchema, requireOnboarded: false }, async ({ ctx, body }) => {
  if (ctx.roles.length === 0) throw new ApiError(403, "forbidden", "You are not allowed to do that.");
  return perform(ctx, body);
});

async function perform(ctx: AppContext, a: AdminAction): Promise<unknown> {
  const db = ctx.supabase;
  switch (a.action) {
    case "review_claim": {
      let playerId: number | undefined;
      if (a.approve) {
        const { data: claim } = await db.from("chess_link_claims").select("chess_username").eq("id", a.claim_id).maybeSingle();
        if (claim) {
          // Best effort: record Chess.com's own player id so renames can be detected later.
          playerId = await getChessClient().getProfile(claim.chess_username).then((p) => p.player_id, () => undefined);
        }
      }
      return unwrap(await db.rpc("admin_review_claim", { p_claim_id: a.claim_id, p_approve: a.approve, p_reason: a.reason, p_player_id: playerId }));
    }
    case "unlink_account":
      return { unlinked: unwrap(await db.rpc("admin_unlink_chess_account", { p_user: a.user_id, p_reason: a.reason })) };
    case "resolve_recovery": {
      const row = unwrap(await db.rpc("admin_resolve_recovery", { p_request_id: a.request_id, p_approve: a.approve, p_reason: a.reason }));
      return { id: row.id, status: row.status };
    }
    case "add_eligibility":
      return { added: unwrap(await db.rpc("admin_add_eligibility", { p_kind: a.kind, p_values: a.values, p_note: a.note })) };
    case "remove_eligibility":
      unwrap(await db.rpc("admin_remove_eligibility", { p_id: a.id, p_reason: a.reason }));
      return { removed: true };
    case "set_user_eligibility":
      unwrap(await db.rpc("admin_set_user_eligibility", { p_user: a.user_id, p_status: a.status, p_reason: a.reason }));
      return { updated: true };
    case "review_eligibility_request": {
      const row = unwrap(await db.rpc("admin_review_eligibility_request", { p_id: a.id, p_approve: a.approve, p_reason: a.reason }));
      return { id: row.id, status: row.status };
    }
    case "set_account_status": {
      unwrap(await db.rpc("admin_set_account_status", { p_user: a.user_id, p_suspend: a.suspend, p_reason: a.reason }));
      // Also block (or restore) sign-in at the Auth layer. The database call above has already
      // verified the caller's role, so using the service key here is safe.
      const admin = createSupabaseAdminClient();
      if (admin) await admin.auth.admin.updateUserById(a.user_id, { ban_duration: a.suspend ? "876000h" : "none" });
      return { updated: true, authBanApplied: Boolean(admin) };
    }
    case "set_role":
      unwrap(await db.rpc("admin_set_role", { p_user: a.user_id, p_role: a.role, p_grant: a.grant, p_reason: a.reason }));
      return { updated: true };
    case "update_setting":
      unwrap(await db.rpc("admin_update_setting", { p_key: a.key, p_value: a.value as Json, p_reason: a.reason }));
      return { updated: true };
    case "resolve_with_game": {
      // The moderator supplies a game URL; make sure that game is in our records by importing
      // both players' archives first (the database refuses a game it has not stored).
      const { data: ch } = await db.from("challenges").select("*").eq("id", a.challenge_id).maybeSingle();
      if (!ch || !ch.accepted_at) throw new ApiError(404, "not_found", "That challenge could not be found or was never accepted.");
      const admin = createSupabaseAdminClient();
      if (!admin) throw new ApiError(503, "not_configured", "Importing archives needs the server service key to be configured.");
      const store = createSupabaseSyncStore(admin);
      await refreshArchives(
        store,
        getChessClient(),
        {
          id: ch.id, status: ch.status, challengerUsername: ch.challenger_username, recipientUsername: ch.recipient_username,
          timeControl: ch.time_control, acceptedAt: new Date(ch.accepted_at), giveupAt: null, settleUntil: null,
          checkCount: ch.check_count, candidateGameIds: ch.candidate_game_ids,
        },
        await store.memberUsernames(),
        new Date(),
      );
      return { match_id: unwrap(await db.rpc("admin_resolve_challenge_with_game", { p_challenge_id: a.challenge_id, p_game_url: a.game_url, p_reason: a.reason })) };
    }
    case "manual_result":
      return {
        match_id: unwrap(
          await db.rpc("admin_record_manual_result", {
            p_challenge_id: a.challenge_id, p_game_url: a.game_url, p_winner: a.winner,
            p_white_is_challenger: a.white_is_challenger, p_ended_at: a.ended_at ?? new Date().toISOString(), p_reason: a.reason,
          }),
        ),
      };
    case "void_challenge":
      unwrap(await db.rpc("admin_void_challenge", { p_challenge_id: a.challenge_id, p_reason: a.reason }));
      return { voided: true };
    case "correct_match":
      unwrap(await db.rpc("admin_correct_match", { p_match_id: a.match_id, p_result: a.result, p_reason: a.reason }));
      return { corrected: true };
    case "retry_challenge_sync":
      unwrap(await db.rpc("admin_retry_challenge_sync", { p_challenge_id: a.challenge_id }));
      return { queued: true };
    case "resolve_dispute":
      unwrap(await db.rpc("admin_resolve_dispute", { p_dispute_id: a.dispute_id, p_status: a.status, p_note: a.note }));
      return { resolved: true };
    case "retry_player_sync":
      unwrap(await db.rpc("admin_retry_player_sync", { p_user: a.user_id }));
      return { queued: true };
  }
}
