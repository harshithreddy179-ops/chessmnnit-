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
  };
}

export type IntegrationState = "ready" | "missing" | "partial";

export interface IntegrationStatus {
  supabase: IntegrationState;
  serviceRole: IntegrationState;
  cron: IntegrationState;
  chessApi: { state: IntegrationState; contactConfigured: boolean };
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
  };
}
