import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

/**
 * Builds a migrated TEMPLATE database once per test run:
 *   Supabase platform shim  ->  every file in supabase/migrations, in order.
 * Each test file then clones it (CREATE DATABASE ... TEMPLATE), which is near-instant and
 * gives every file a pristine schema. This also proves the migrations apply from scratch.
 */
export const TEMPLATE_DB = "mnnit_test_template";

export function adminUrl(db = "postgres"): string {
  const base = process.env.TEST_DATABASE_ADMIN_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/postgres";
  const url = new URL(base);
  url.pathname = `/${db}`;
  return url.toString();
}

export default async function setup() {
  const root = process.cwd();
  const admin = new Client({ connectionString: adminUrl() });
  try {
    await admin.connect();
  } catch (error) {
    throw new Error(
      `Cannot reach PostgreSQL for the database tests (${(error as Error).message}). ` +
        "Start a local server and set TEST_DATABASE_ADMIN_URL (see docs/TESTING.md).",
    );
  }

  const exists = await admin.query("select 1 from pg_database where datname = $1", [TEMPLATE_DB]);
  if (exists.rowCount) {
    await admin.query(`alter database ${TEMPLATE_DB} is_template false`);
    await admin.query(`drop database ${TEMPLATE_DB} with (force)`);
  }
  await admin.query(`create database ${TEMPLATE_DB}`);
  await admin.end();

  const db = new Client({ connectionString: adminUrl(TEMPLATE_DB) });
  await db.connect();
  await db.query(readFileSync(join(root, "tests/db/supabase-shim.sql"), "utf8"));
  const dir = join(root, "supabase/migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    try {
      await db.query(readFileSync(join(dir, file), "utf8"));
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }
  await db.end();

  const finish = new Client({ connectionString: adminUrl() });
  await finish.connect();
  await finish.query(`alter database ${TEMPLATE_DB} is_template true`);
  await finish.end();
}
