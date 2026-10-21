import "server-only";

/**
 * Server-only configuration. Importing this from a Client Component fails the build
 * (via `server-only`), which keeps secrets out of the browser bundle.
 */
import { isSupabaseConfigured } from "@/lib/env";

function nonEmpty(value: string | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

/** Supabase secret / service-role key. Bypasses RLS — only use in trusted server code. */
export function getSupabaseSecretKey(): string | null {
  return (
    nonEmpty(process.env.SUPABASE_SECRET_KEY) ?? nonEmpty(process.env.SUPABASE_SERVICE_ROLE_KEY)
  );
}

export function getCronSecret(): string | null {
  const secret = nonEmpty(process.env.CRON_SECRET);
  // A short secret is guessable; treat it as not configured so cron endpoints stay closed.
  return secret && secret.length >= 24 ? secret : null;
}

export interface ChessComRuntimeConfig {
  /** Sent in the User-Agent so Chess.com can contact us instead of blocking us. */
  contact: string | null;
  /** Minimum gap between two outgoing requests (ms). Requests are strictly serial. */
  minRequestIntervalMs: number;
  /** Per-request timeout. */
  timeoutMs: number;
  maxRetries: number;
  /** Whether the proof-of-ownership code check against the public profile is offered. */
  profileCodeVerification: boolean;
}

export function getChessComConfig(): ChessComRuntimeConfig {
  const int = (v: string | undefined, d: number, min: number, max: number) => {
    const n = Number.parseInt(v ?? "", 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
  };
  return {
    contact: nonEmpty(process.env.CHESSCOM_CONTACT_EMAIL),
    minRequestIntervalMs: int(process.env.CHESSCOM_MIN_REQUEST_INTERVAL_MS, 400, 100, 10_000),
    timeoutMs: int(process.env.CHESSCOM_REQUEST_TIMEOUT_MS, 10_000, 1_000, 60_000),
    maxRetries: int(process.env.CHESSCOM_MAX_RETRIES, 3, 0, 6),
    profileCodeVerification: (process.env.CHESSCOM_PROFILE_CODE_VERIFICATION ?? "true") !== "false",
  };
}

/**
 * Chess.com OAuth is only available to applications Chess.com has approved and issued
 * credentials to. Credentials alone are not enough for this app: the OAuth provider
 * adapter is intentionally not implemented until the approved endpoints are available
 * (see docs/CHESSCOM_INTEGRATION.md).
 */
export function getChessComOAuthCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = nonEmpty(process.env.CHESSCOM_OAUTH_CLIENT_ID);
  const clientSecret = nonEmpty(process.env.CHESSCOM_OAUTH_CLIENT_SECRET);
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export type IntegrationState = "ready" | "missing" | "partial";

export interface IntegrationStatus {
  supabase: IntegrationState;
  serviceRole: IntegrationState;
  cron: IntegrationState;
  chessApi: { state: IntegrationState; contactConfigured: boolean };
  chessProfileCode: boolean;
  chessOAuth: "not_implemented_awaiting_approval" | "credentials_present_adapter_missing";
}

/** Boolean-only summary for the admin UI. Never returns secret values. */
export function getIntegrationStatus(): IntegrationStatus {
  const chess = getChessComConfig();
  return {
    supabase: isSupabaseConfigured() ? "ready" : "missing",
    serviceRole: getSupabaseSecretKey() ? "ready" : "missing",
    cron: getCronSecret() ? "ready" : "missing",
    chessApi: {
      state: chess.contact ? "ready" : "partial",
      contactConfigured: Boolean(chess.contact),
    },
    chessProfileCode: chess.profileCodeVerification,
    chessOAuth: getChessComOAuthCredentials()
      ? "credentials_present_adapter_missing"
      : "not_implemented_awaiting_approval",
  };
}
