import { randomUUID, randomBytes } from "node:crypto";
import { Client, Pool, type QueryResult, type QueryResultRow } from "pg";
import { adminUrl, TEMPLATE_DB } from "./global-setup";

export type ApiRole = "anon" | "authenticated" | "service_role";

export interface Actor {
  /** Run one statement in its own transaction as this actor (RLS applies). */
  query<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  /** Run several statements in ONE transaction as this actor. */
  tx<T>(fn: (q: (sql: string, params?: unknown[]) => Promise<QueryResult>) => Promise<T>): Promise<T>;
}

export interface TestDb {
  name: string;
  /** Superuser connection pool: bypasses everything. Use for arranging/inspecting only. */
  admin: Pool;
  /** An authenticated client carrying a JWT for `userId`, with optional extra claims. */
  as(userId: string, extraClaims?: Record<string, unknown>): Actor;
  anon: Actor;
  service: Actor;
  createUser(opts?: { email?: string; name?: string; confirmed?: boolean }): Promise<{ id: string; email: string }>;
  allowEmail(email: string): Promise<void>;
  /** Drives the real flow: allowlist -> eligibility -> claim -> verification -> onboarding. */
  onboard(opts?: { username?: string; name?: string; email?: string; playerId?: number }): Promise<Player>;
  makeAdmin(userId: string, role: "super_admin" | "verification_admin" | "match_moderator" | "analyst"): Promise<void>;
  /** Creates a linked pair, an accepted challenge and an imported game between them. */
  close(): Promise<void>;
}

export interface Player {
  id: string;
  email: string;
  username: string;
  playerId: number;
}

function claimsFor(userId: string | null, role: ApiRole, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...(userId ? { sub: userId } : {}), role, aud: role, ...extra });
}

function makeActor(pool: Pool, role: ApiRole, userId: string | null, extra: Record<string, unknown> = {}): Actor {
  const run = async <T>(fn: (c: import("pg").PoolClient) => Promise<T>): Promise<T> => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(`set local role ${role}`);
      await client.query("select set_config('request.jwt.claims', $1, true)", [claimsFor(userId, role, extra)]);
      const out = await fn(client);
      await client.query("commit");
      return out;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  };
  return {
    query: (sql, params) => run((c) => c.query(sql, params as unknown[])) as never,
    tx: (fn) => run((c) => fn((sql, params) => c.query(sql, params as unknown[]))),
  };
}

let counter = 0;

export async function createTestDb(): Promise<TestDb> {
  const name = `t_${Date.now().toString(36)}_${(counter++).toString(36)}_${randomBytes(3).toString("hex")}`;
  const root = new Client({ connectionString: adminUrl() });
  await root.connect();
  await root.query(`create database ${name} template ${TEMPLATE_DB}`);
  await root.end();
  return bindTestDb(name, true);
}

/**
 * Wraps an existing, already-migrated database with the actor helpers (anon / authenticated /
 * service_role, onboarding, admin grants). `dropOnClose` removes the database afterwards.
 */
export function bindTestDb(name: string, dropOnClose: boolean): TestDb {
  const admin = new Pool({ connectionString: adminUrl(name), max: 12 });

  const db: TestDb = {
    name,
    admin,
    as: (userId, extra) => makeActor(admin, "authenticated", userId, extra),
    anon: makeActor(admin, "anon", null),
    service: makeActor(admin, "service_role", null),

    async createUser(opts = {}) {
      const id = randomUUID();
      const email = opts.email ?? `student-${id.slice(0, 8)}@example.test`;
      await admin.query(
        `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
         values ($1, $2, $3, $4::jsonb)`,
        [id, email, opts.confirmed === false ? null : new Date(), JSON.stringify(opts.name ? { full_name: opts.name } : {})],
      );
      return { id, email };
    },

    async allowEmail(email) {
      await admin.query(
        "insert into public.student_eligibility (kind, value) values ('email', lower($1)) on conflict do nothing",
        [email],
      );
    },

    async onboard(opts = {}) {
      const user = await db.createUser({ email: opts.email, name: opts.name ?? "Test Player" });
      const username = opts.username ?? `p${randomBytes(4).toString("hex")}`;
      const playerId = opts.playerId ?? Math.floor(Math.random() * 1_000_000_000);
      await db.allowEmail(user.email);
      const me = db.as(user.id);
      await me.query("select public.claim_eligibility()");
      const claim = await me.query<{ id: string }>("select * from public.start_chess_claim($1)", [username]);
      const res = await db.service.query<{ confirm_chess_link: { ok: boolean; reason?: string } }>(
        "select public.confirm_chess_link($1, $2, $3, 'profile_code')",
        [claim.rows[0]!.id, username, playerId],
      );
      if (!res.rows[0]!.confirm_chess_link.ok) {
        throw new Error(`verification failed: ${JSON.stringify(res.rows[0])}`);
      }
      await me.query("update public.profiles set display_name = $1 where id = $2", [opts.name ?? "Test Player", user.id]);
      await me.query("select public.complete_onboarding()");
      return { id: user.id, email: user.email, username, playerId };
    },

    async makeAdmin(userId, role) {
      await admin.query("insert into public.admin_roles (user_id, role) values ($1, $2) on conflict do nothing", [userId, role]);
    },

    async close() {
      await admin.end();
      if (!dropOnClose) return;
      const c = new Client({ connectionString: adminUrl() });
      await c.connect();
      await c.query(`drop database if exists ${name} with (force)`);
      await c.end();
    },
  };
  return db;
}

/** Postgres error helpers for readable assertions. */
export async function sqlError(promise: Promise<unknown>): Promise<{ code?: string; message: string }> {
  try {
    await promise;
  } catch (error) {
    const e = error as { code?: string; message: string };
    return { code: e.code, message: e.message };
  }
  throw new Error("expected the statement to fail, but it succeeded");
}

export const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
export const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
