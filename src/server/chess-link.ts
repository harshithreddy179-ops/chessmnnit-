import "server-only";

import { ChessComError } from "@/lib/chess/client";
import { parseChessUsername } from "@/lib/chess/username";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { ApiError, unwrap } from "@/server/api";
import type { AppContext } from "@/server/auth";
import { getChessClient } from "@/server/chess";
import { syncOnePlayer } from "@/server/sync/players";

const REASON_TEXT: Record<string, string> = {
  chess_account_already_linked:
    "That Chess.com username is already linked to another member. If it is yours, ask an administrator to fix it.",
  user_already_linked:
    "Your account already has a Chess.com link. Ask an administrator if it needs to change.",
};

/**
 * Links the Chess.com username the player typed. There is no ownership proof: the link is
 * recorded as self-declared and administrators can replace it. The one thing we do check is that
 * the account exists, so a typo does not end up in the directory. If Chess.com cannot be reached
 * we still link (a Chess.com outage must not stop sign-ups) and say plainly that it was not checked.
 */
export async function linkOwnChessAccount(ctx: AppContext, usernameInput: string) {
  const username = parseChessUsername(usernameInput);
  if (!username) {
    throw new ApiError(
      400,
      "invalid_username",
      "Enter a valid Chess.com username: 3–25 letters, digits, underscores or hyphens.",
    );
  }

  let confirmedToExist = false;
  try {
    const profile = await getChessClient().getProfile(username);
    if (profile.status?.toLowerCase().startsWith("closed")) {
      throw new ApiError(400, "account_closed", "That Chess.com account is closed.");
    }
    confirmedToExist = true;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof ChessComError && (error.kind === "not_found" || error.kind === "gone")) {
      throw new ApiError(
        404,
        "chess_username_not_found",
        `No Chess.com account named "${username}" was found. Check the spelling.`,
      );
    }
  }

  const result = unwrap(
    await ctx.supabase.rpc("link_my_chess_account", { p_username: username }),
  ) as { ok: boolean; reason?: string };
  if (!result.ok) {
    throw new ApiError(
      409,
      result.reason ?? "rejected",
      REASON_TEXT[result.reason ?? ""] ?? "That Chess.com account could not be linked.",
    );
  }

  // First ratings straight away (best effort; the scheduled job retries on failure).
  const admin = createSupabaseAdminClient();
  if (admin && confirmedToExist) {
    await syncOnePlayer(admin, getChessClient(), {
      user_id: ctx.user.id,
      chess_username: username,
      chess_player_id: null,
    });
  }
  return { chess_username: username, accountConfirmed: confirmedToExist };
}
