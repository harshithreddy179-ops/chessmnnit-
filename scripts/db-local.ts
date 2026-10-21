/**
 * Prepares a plain local PostgreSQL database with this project's schema, for development
 * without the Supabase CLI / Docker.
 *
 *   npm run db:local                  create (if needed) and apply any new migrations
 *   npm run db:local -- --reset       drop and rebuild from scratch
 *   npm run db:local -- --seed        also load supabase/seed.sql (DEMO data, local only)
 *
 * It first installs tests/db/supabase-shim.sql, a small stand-in for the parts of the Supabase
 * platform the migrations rely on (roles, auth.users, auth.uid()). NEVER use this against a real
 * Supabase project: there, apply the migrations with `supabase db push` instead
 * (docs/DEPLOYMENT.md).
 *
 * Connection: LOCAL_DATABASE_URL, default postgres://postgres:postgres@127.0.0.1:5432/mnnit_dev
 * (the role must be allowed to create databases and roles).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const target = new URL(
  process.env.LOCAL_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/mnnit_dev",
);
const dbName = target.pathname.replace(/^\//, "");
if (!/^[a-z_][a-z0-9_]*$/.test(dbName)) {
  throw new Error(
    `Refusing to use database name "${dbName}" (letters, digits and underscores only).`,
  );
}
if (!["127.0.0.1", "localhost", "::1", "[::1]", "host.docker.internal"].includes(target.hostname)) {
  throw new Error(
    `LOCAL_DATABASE_URL points at ${target.hostname}. This script installs a test shim and is only for a local database.`,
  );
}

const reset = process.argv.includes("--reset");
const seed = process.argv.includes("--seed");
const root = process.cwd();

async function main() {
  const admin = new Client({ connectionString: new URL("/postgres", target).toString() });
  await admin.connect();
  const exists = (await admin.query("select 1 from pg_database where datname = $1", [dbName]))
    .rowCount;
  if (exists && reset) {
    await admin.query(`drop database ${dbName} with (force)`);
  }
  if (!exists || reset) {
    await admin.query(`create database ${dbName}`);
    console.log(`created database ${dbName}`);
  }
  await admin.end();

  const db = new Client({ connectionString: target.toString() });
  await db.connect();
  const hasShim = (await db.query("select to_regclass('auth.users') as t")).rows[0].t !== null;
  if (!hasShim) {
    await db.query(readFileSync(join(root, "tests/db/supabase-shim.sql"), "utf8"));
    console.log("installed the local Supabase shim");
  }

  await db.query("create schema if not exists local_dev");
  await db.query(
    "create table if not exists local_dev.applied_migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  const done = new Set(
    (await db.query("select name from local_dev.applied_migrations")).rows.map(
      (r) => r.name as string,
    ),
  );
  const dir = join(root, "supabase/migrations");
  let applied = 0;
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    if (done.has(file)) continue;
    try {
      await db.query(readFileSync(join(dir, file), "utf8"));
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
    await db.query("insert into local_dev.applied_migrations (name) values ($1)", [file]);
    console.log(`applied ${file}`);
    applied++;
  }
  if (applied === 0) console.log("schema is up to date");

  if (seed) {
    await db.query(readFileSync(join(root, "supabase/seed.sql"), "utf8"));
    console.log(
      "loaded supabase/seed.sql (DEMO data; hidden unless include_demo_data is on, which the seed turns on)",
    );
  }
  await db.end();
  console.log(`\nLOCAL_DATABASE_URL=${target.toString().replace(/:[^:@/]*@/, ":***@")}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
