import type { ProviderStatus } from "@/lib/chess/verification/types";

export interface ProviderEnv {
  /** CHESSCOM_PROFILE_CODE_VERIFICATION (default on). */
  profileCodeEnabled: boolean;
  /** Whether OAuth client credentials have been issued by Chess.com and configured. */
  oauthCredentialsPresent: boolean;
}

/**
 * What each ownership-verification route can honestly do in this deployment.
 *
 * OAuth: Chess.com's OAuth 2.0 (Authorization Code + PKCE) is only available to
 * applications Chess.com has approved. This project has no approved credentials, and the
 * adapter is intentionally NOT implemented rather than guessed: endpoints, scopes and
 * claims must come from the approval documentation. The interface (types.ts) is where it plugs in.
 */
export function describeProviders(env: ProviderEnv): ProviderStatus[] {
  return [
    {
      id: "oauth",
      label: "Sign in with Chess.com",
      state: "awaiting_approval",
      description: env.oauthCredentialsPresent
        ? "OAuth credentials are present, but the Chess.com OAuth adapter has not been implemented against the approved endpoints yet."
        : "Chess.com OAuth requires Chess.com's approval and issued client credentials. Not available yet.",
    },
    {
      id: "profile_code",
      label: "Profile code check",
      state: env.profileCodeEnabled ? "available" : "unavailable",
      description: env.profileCodeEnabled
        ? "Add a one-time code to your Chess.com profile; we read your public profile to confirm it. Chess.com caches published data, so it can take a while to appear."
        : "Disabled by the administrators of this deployment.",
    },
    {
      id: "admin_review",
      label: "Administrator review",
      state: "available",
      description: "A verification administrator confirms ownership manually. Use this if the code check cannot work for you.",
    },
  ];
}
