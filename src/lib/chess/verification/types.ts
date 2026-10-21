/**
 * Chess.com ownership verification sits behind this small interface so that an approved
 * integration (official OAuth) can be added later without touching the rest of the app.
 *
 * Honest status model — a provider is only ever "available" if it can really verify:
 *   available          works today in this deployment
 *   unavailable        disabled by configuration
 *   awaiting_approval  requires Chess.com approval / credentials that have not been issued
 */
export type VerificationProviderId = "profile_code" | "admin_review" | "oauth";
export type ProviderState = "available" | "unavailable" | "awaiting_approval";

export interface ProviderStatus {
  id: VerificationProviderId;
  label: string;
  state: ProviderState;
  /** What the person should know, in plain words. Never claims a capability that is not there. */
  description: string;
}

export type CheckFailure =
  | "code_not_found"
  | "profile_not_found"
  | "username_mismatch"
  | "account_closed"
  | "renamed"
  | "rate_limited"
  | "unavailable";

export type CheckResult =
  | { verified: true; username: string; playerId: number | null }
  | { verified: false; reason: CheckFailure; detail?: string };
