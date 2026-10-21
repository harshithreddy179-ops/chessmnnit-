import "server-only";

import { ChessComError } from "@/lib/chess/client";
import { parseChessUsername } from "@/lib/chess/username";
import { checkProfileCode } from "@/lib/chess/verification/profile-code";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { getChessComConfig } from "@/lib/env.server";
import { ApiError, unwrap } from "@/server/api";
import type { AppContext } from "@/server/auth";
import { getChessClient } from "@/server/chess";
import { syncOnePlayer } from "@/server/sync/players";

const REASON_TEXT: Record<string, string> = {
  code_not_found:
    "We could not see the code on your public Chess.com profile yet. Chess.com caches published data, so changes can take a while to appear — wait a little and try again, or ask an administrator to review.",
  profile_not_found: "That Chess.com account could not be found.",
  username_mismatch: "Chess.com returned a different account than the one you entered.",
  account_closed: "That Chess.com account is closed.",
  renamed: "That Chess.com account appears to have been renamed. Contact an administrator.",
  rate_limited: "Chess.com is limiting requests right now. Please try again in a few minutes.",
  unavailable: "Chess.com could not be reached right now. Please try again shortly.",
  chess_account_already_linked:
    "That Chess.com username is already linked to another member. If it is yours, request account recovery.",
  user_already_linked: "Your account already has a verified Chess.com link.",
  claim_expired: "That verification code has expired. Start again to get a new one.",
  claim_not_open: "There is no open verification to check.",
  username_mismatch_claim: "The username does not match the claim.",
};

export function explainVerificationReason(reason: string): string {
  return REASON_TEXT[reason] ?? "Verification did not succeed.";
}

/** Step 2 of onboarding: start a claim. The database issues the code. */
export async function startClaim(ctx: AppContext, usernameInput: string) {
  const username = parseChessUsername(usernameInput);
  if (!username) {
    throw new ApiError(
      400,
      "invalid_username",
      "Enter a valid Chess.com username: 3–25 letters, digits, underscores or hyphens.",
    );
  }

  // Confirm the account exists. If Chess.com is merely unreachable we still allow the claim
  // (the administrator-review route needs no live API), but we never pretend it was checked.
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
        `No Chess.com account named "${username}" was found.`,
      );
    }
  }

  const claim = unwrap(
    await ctx.supabase.rpc("start_chess_claim", { p_username: username, p_method: "profile_code" }),
  );
  return { claim, accountConfirmed: confirmedToExist };
}

/** Step 3: read the public profile; if the code is there, the trusted server links the account. */
export async function checkClaim(ctx: AppContext) {
  const config = getChessComConfig();
  if (!config.profileCodeVerification) {
    throw new ApiError(
      409,
      "method_unavailable",
      "Automatic verification is turned off. Ask an administrator to review your claim.",
    );
  }
  const claim = ctx.claim;
  if (!claim || claim.status !== "pending" || !claim.verification_code) {
    throw new ApiError(409, "no_open_claim", "Start verification first.");
  }
  const admin = createSupabaseAdminClient();
  if (!admin) {
    throw new ApiError(
      503,
      "not_configured",
      "Chess.com verification is awaiting server configuration (service key). Ask an administrator to review your claim.",
    );
  }

  const allowed = unwrap(
    await ctx.supabase.rpc("consume_rate_limit", {
      p_action: "claim_check",
      p_max: 8,
      p_window_seconds: 600,
    }),
  );
  if (!allowed)
    throw new ApiError(
      429,
      "rate_limited",
      "You are checking too often. Wait a few minutes and try again.",
    );

  const result = await checkProfileCode(getChessClient(), {
    username: claim.chess_username,
    code: claim.verification_code,
  });
  if (!result.verified) {
    unwrap(
      await admin.rpc("record_claim_check", { p_claim_id: claim.id, p_result: result.reason }),
    );
    return {
      verified: false as const,
      reason: result.reason,
      message: explainVerificationReason(result.reason),
    };
  }

  const confirmed = unwrap(
    await admin.rpc("confirm_chess_link", {
      p_claim_id: claim.id,
      p_observed_username: result.username,
      p_observed_player_id: result.playerId ?? undefined,
      p_method: "profile_code",
    }),
  ) as { ok: boolean; reason?: string };
  if (!confirmed.ok) {
    return {
      verified: false as const,
      reason: confirmed.reason ?? "rejected",
      message: explainVerificationReason(confirmed.reason ?? ""),
    };
  }

  // Pull the first ratings straight away (best effort; the scheduled job retries on failure).
  await syncOnePlayer(admin, getChessClient(), {
    user_id: ctx.user.id,
    chess_username: result.username,
    chess_player_id: result.playerId,
  });
  return { verified: true as const };
}
