import { Pool } from "pg";
import { adminUrl, createMigratedDatabase } from "../db/global-setup";
import { startFakeSupabase } from "./fake-supabase";
import { E2E } from "./env";

/**
 * Playwright `webServer` entry: builds a fresh migrated database and serves the Supabase
 * stand-in on top of it. The Next.js app (started separately) points at this.
 */
async function main() {
  await createMigratedDatabase(E2E.dbName);
  const pool = new Pool({ connectionString: adminUrl(E2E.dbName), max: 16 });
  await startFakeSupabase({ pool, port: E2E.supabasePort, publishableKey: E2E.publishableKey, secretKey: E2E.secretKey });
  console.log(`[e2e] Supabase stand-in ready on :${E2E.supabasePort} (database ${E2E.dbName})`);
  const stop = () => void pool.end().finally(() => process.exit(0));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
