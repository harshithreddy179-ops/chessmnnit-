/** Shared constants for the browser tests. Values are fake, local-only and safe to commit. */
export const E2E = {
  dbName: "mnnit_e2e",
  appPort: 3101,
  supabasePort: 54399,
  chessPort: 54398,
  publishableKey: "sb_publishable_e2e_local_only",
  secretKey: "sb_secret_e2e_local_only",
  cronSecret: "e2e-cron-secret-0123456789abcdef0123",
} as const;

export const appUrl = `http://localhost:${E2E.appPort}`;
export const supabaseUrl = `http://localhost:${E2E.supabasePort}`;

/** Environment the application under test is built and started with. */
export const appEnv = {
  NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: E2E.publishableKey,
  SUPABASE_SECRET_KEY: E2E.secretKey,
  CRON_SECRET: E2E.cronSecret,
  NEXT_PUBLIC_APP_URL: appUrl,
  CHESSCOM_API_BASE_URL: `http://127.0.0.1:${E2E.chessPort}/pub`,
  CHESSCOM_CONTACT_EMAIL: "e2e@example.test",
  CHESSCOM_MIN_REQUEST_INTERVAL_MS: "100",
  CHESSCOM_MAX_RETRIES: "0",
  PUBLIC_DATA_REVALIDATE_SECONDS: "1",
};
