import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, sqlError, type Player, type TestDb } from "./helpers";

let db: TestDb;
let alice: Player;
let bob: Player;
let outsider: { id: string; email: string };

beforeAll(async () => {
  db = await createTestDb();
  alice = await db.onboard({ username: "alice_rls", name: "Alice" });
  bob = await db.onboard({ username: "bob_rls", name: "Bob" });
  outsider = await db.createUser({ name: "Not Yet Approved" });
});
afterAll(async () => {
  await db.close();
});

describe("structural guarantees (these fail if a future migration regresses)", () => {
  it("has row level security enabled on every table in public and app_private", async () => {
    const r = await db.admin.query(
      `select n.nspname || '.' || c.relname as t
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where c.relkind in ('r', 'p') and n.nspname in ('public', 'app_private') and not c.relrowsecurity`,
    );
    expect(r.rows).toEqual([]);
  });

  it("pins search_path on every SECURITY DEFINER function", async () => {
    const r = await db.admin.query(
      `select n.nspname || '.' || p.proname as f
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'app_private') and p.prosecdef
          and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')`,
    );
    expect(r.rows).toEqual([]);
  });

  it("exposes only the intended functions to anon and authenticated", async () => {
    const rows = (
      await db.admin.query(
        `select p.proname,
                has_function_privilege('anon', p.oid, 'execute') as anon,
                has_function_privilege('authenticated', p.oid, 'execute') as authed
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.prokind = 'f'`,
      )
    ).rows;

    const anonOk = new Set([
      "get_leaderboard",
      "get_player_directory",
      "get_recent_matches",
      "get_public_summary",
      "normalize_chess_username",
      "is_valid_chess_username",
    ]);
    const authedOk = new Set([
      ...anonOk,
      "consume_rate_limit",
      "claim_eligibility",
      "request_eligibility_review",
      "start_chess_claim",
      "cancel_chess_claim",
      "submit_claim_for_review",
      "complete_onboarding",
      "request_account_recovery",
      "open_match_dispute",
      "admin_unlink_chess_account",
      "admin_resolve_recovery",
      "admin_add_eligibility",
      "admin_remove_eligibility",
      "admin_set_user_eligibility",
      "admin_review_eligibility_request",
      "admin_review_claim",
      "admin_set_account_status",
      "admin_set_role",
      "admin_resolve_challenge_with_game",
      "admin_record_manual_result",
      "admin_void_challenge",
      "admin_correct_match",
      "admin_retry_challenge_sync",
      "admin_resolve_dispute",
      "admin_update_setting",
      "admin_overview",
      "admin_retry_player_sync",
      "link_my_chess_account",
      "admin_set_chess_link",
    ]);

    const unexpectedAnon = rows
      .filter((r) => r.anon && !anonOk.has(r.proname))
      .map((r) => r.proname);
    const unexpectedAuthed = rows
      .filter((r) => r.authed && !authedOk.has(r.proname))
      .map((r) => r.proname);
    const missing = [...authedOk].filter((n) => !rows.some((r) => r.proname === n && r.authed));
    expect(unexpectedAnon).toEqual([]);
    expect(unexpectedAuthed).toEqual([]);
    expect(missing).toEqual([]);
  });

  it("grants no table privileges to anon beyond the public read set", async () => {
    const r = await db.admin.query(
      `select table_name, privilege_type from information_schema.role_table_grants
        where grantee = 'anon' and table_schema = 'public' order by 1, 2`,
    );
    const tables = [...new Set(r.rows.map((x) => x.table_name))].sort();
    expect(tables).toEqual([
      "app_settings",
      "chess_account_links",
      "chess_rating_history",
      "chess_ratings",
      "college_matches",
      "player_stats",
      "profiles",
      "supported_time_controls",
    ]);
    expect(r.rows.every((x) => x.privilege_type === "SELECT")).toBe(true);
  });
});

describe("anonymous visitors", () => {
  it("cannot read any private table", async () => {
    for (const t of [
      "student_eligibility",
      "eligibility_requests",
      "chess_link_claims",
      "chess_link_history",
      "account_recovery_requests",
      "notifications",
      "profile_settings",
      "admin_roles",
      "audit_logs",
      "job_runs",
      "imported_chess_games",
      "chess_archive_state",
      "challenges",
      "challenge_events",
      "match_sync_attempts",
      "match_disputes",
      "chess_sync_state",
    ]) {
      const err = await sqlError(db.anon.query(`select * from public.${t} limit 1`));
      expect(err.code, `anon should not read ${t}`).toBe("42501");
    }
  });

  it("cannot write anything", async () => {
    for (const sql of [
      "update public.profiles set display_name = 'hacked'",
      "delete from public.profiles",
      "insert into public.notifications (user_id, type, title) values (gen_random_uuid(), 'account_notice', 'x')",
      "insert into public.college_matches (game_url, white_username, black_username, result, ended_at, source) values ('https://www.chess.com/game/live/1', 'aaa', 'bbb', 'white', now(), 'admin')",
    ]) {
      expect((await sqlError(db.anon.query(sql))).code).toBe("42501");
    }
  });

  it("sees approved public profiles only", async () => {
    const ids = (await db.anon.query("select id from public.profiles")).rows.map((r) => r.id);
    expect(ids).toContain(alice.id);
    expect(ids).not.toContain(outsider.id);
  });
});

describe("profiles", () => {
  it("lets a user edit only their display fields", async () => {
    const ok = await db
      .as(alice.id)
      .query(
        "update public.profiles set display_name = 'Alice B', bio = 'Rapid fan', open_to_challenges = true where id = $1 returning display_name",
        [alice.id],
      );
    expect(ok.rows[0].display_name).toBe("Alice B");

    for (const col of [
      "is_approved = true",
      "eligibility_status = 'revoked'",
      "eligibility_status = 'verified'",
      "account_status = 'suspended'",
      "avatar_url = 'https://evil.example/x.png'",
      "is_demo = true",
      "onboarding_completed_at = null",
      "id = gen_random_uuid()",
    ]) {
      const err = await sqlError(
        db.as(alice.id).query(`update public.profiles set ${col} where id = $1`, [alice.id]),
      );
      expect(err.code, col).toBe("42501");
    }
  });

  it("cannot edit someone else's profile", async () => {
    const r = await db
      .as(alice.id)
      .query("update public.profiles set display_name = 'Pwned' where id = $1", [bob.id]);
    expect(r.rowCount).toBe(0);
    expect(
      (await db.admin.query("select display_name from public.profiles where id = $1", [bob.id]))
        .rows[0].display_name,
    ).toBe("Bob");
  });

  it("validates display names", async () => {
    for (const bad of ["x", "a".repeat(41), "bad\u0007name"]) {
      const err = await sqlError(
        db
          .as(alice.id)
          .query("update public.profiles set display_name = $1 where id = $2", [bad, alice.id]),
      );
      expect(err.code).toBe("23514");
    }
  });

  it("lets a user see their own unapproved profile but not others'", async () => {
    const mine = await db.as(outsider.id).query("select id from public.profiles");
    expect(mine.rows.map((r) => r.id)).toContain(outsider.id);
    const peer = await db
      .as(alice.id)
      .query("select id from public.profiles where id = $1", [outsider.id]);
    expect(peer.rowCount).toBe(0);
  });

  it("keeps presence preference private and user-editable", async () => {
    await db
      .as(alice.id)
      .query("update public.profile_settings set presence_mode = 'invisible' where user_id = $1", [
        alice.id,
      ]);
    expect(
      (
        await db
          .as(bob.id)
          .query("select * from public.profile_settings where user_id = $1", [alice.id])
      ).rowCount,
    ).toBe(0);
    expect(
      (await db.as(alice.id).query("select presence_mode from public.profile_settings")).rows,
    ).toEqual([{ presence_mode: "invisible" }]);
    expect(
      (
        await sqlError(
          db
            .as(bob.id)
            .query("update public.profile_settings set user_id = $1 where user_id = $2", [
              alice.id,
              bob.id,
            ]),
        )
      ).code,
    ).toBe("42501");
  });
});

describe("privileged data cannot be written by clients", () => {
  it("denies writes to ratings, imported games, statistics, matches, links and settings", async () => {
    const statements = [
      "insert into public.chess_ratings (user_id, time_class, rating) values ($1, 'rapid', 3000)",
      "update public.chess_ratings set rating = 3000",
      "insert into public.player_stats (user_id, elo) values ($1, 3000)",
      "update public.player_stats set wins = 999",
      "insert into public.imported_chess_games (game_url, white_username, black_username, winner, ended_at) values ('https://www.chess.com/game/live/9', 'aaa', 'bbb', 'white', now())",
      "insert into public.college_matches (game_url, white_username, black_username, result, ended_at, source) values ('https://www.chess.com/game/live/9', 'aaa', 'bbb', 'white', now(), 'admin')",
      "update public.college_matches set result = 'white'",
      "insert into public.app_settings (key, value) values ('x', '1')",
      "update public.app_settings set value = 'true'::jsonb where key = 'include_demo_data'",
      "insert into public.admin_roles (user_id, role) values ($1, 'super_admin')",
      "insert into public.student_eligibility (kind, value) values ('domain', 'gmail.com')",
      "insert into public.audit_logs (action, target_type) values ('x', 'y')",
      "insert into public.notifications (user_id, type, title) values ($1, 'account_notice', 'fake')",
      "insert into public.chess_sync_state (user_id) values ($1)",
    ];
    for (const sql of statements) {
      const err = await sqlError(db.as(alice.id).query(sql, sql.includes("$1") ? [alice.id] : []));
      expect(err.code, sql).toBe("42501");
    }
  });

  it("cannot call service-role functions", async () => {
    for (const sql of [
      "select public.import_chess_games('[]'::jsonb)",
      "select public.recompute_all_stats()",
      "select public.expire_stale_challenges()",
      "select public.run_housekeeping()",
      "select public.bootstrap_super_admin('x@example.test')",
      "select * from public.claim_players_for_sync(5)",
      "select public.record_player_sync(gen_random_uuid(), true)",
    ]) {
      expect((await sqlError(db.as(alice.id).query(sql))).code, sql).toBe("42501");
    }
  });
});

describe("administrator privileges cannot be forged", () => {
  it("rejects admin RPCs from ordinary users", async () => {
    for (const sql of [
      "select public.admin_overview()",
      "select public.admin_set_role(gen_random_uuid(), 'super_admin', true, 'because I said so')",
      "select public.admin_update_setting('include_demo_data', 'true'::jsonb, 'give me demo data')",
      "select public.admin_set_account_status(gen_random_uuid(), true, 'suspend someone')",
      "select public.admin_add_eligibility('email', array['me@example.test'], 'add me')",
    ]) {
      expect((await sqlError(db.as(alice.id).query(sql))).code, sql).toBe("42501");
    }
  });

  it("ignores admin-looking claims in the JWT", async () => {
    const forged = db.as(alice.id, {
      role: "service_role",
      is_admin: true,
      app_metadata: { role: "admin", roles: ["super_admin"] },
      user_metadata: { is_admin: true, role: "super_admin" },
    });
    expect((await sqlError(forged.query("select public.admin_overview()"))).code).toBe("42501");
    expect(
      (
        await sqlError(
          forged.query(
            "insert into public.admin_roles (user_id, role) values ($1, 'super_admin')",
            [alice.id],
          ),
        )
      ).code,
    ).toBe("42501");
    expect((await sqlError(db.anon.query("select 1 from public.admin_roles"))).code).toBe("42501");
  });

  it("only exposes a user's own admin roles to them", async () => {
    const root = await db.createUser();
    await db.makeAdmin(root.id, "analyst");
    expect((await db.as(alice.id).query("select * from public.admin_roles")).rowCount).toBe(0);
    expect((await db.as(root.id).query("select role from public.admin_roles")).rows).toEqual([
      { role: "analyst" },
    ]);
  });

  it("derives permissions from the database, not from the request", async () => {
    const analyst = await db.createUser();
    await db.makeAdmin(analyst.id, "analyst");
    // Analysts can read aggregates but cannot mutate anything.
    expect(
      (await db.as(analyst.id).query("select public.admin_overview() as o")).rows[0].o.players
        .accounts,
    ).toBeGreaterThan(0);
    expect(
      (
        await sqlError(
          db
            .as(analyst.id)
            .query("select public.admin_set_account_status($1, true, 'analyst cannot do this')", [
              bob.id,
            ]),
        )
      ).code,
    ).toBe("42501");
    expect(
      (
        await sqlError(
          db
            .as(analyst.id)
            .query("select public.admin_unlink_chess_account($1, 'analyst cannot do this')", [
              bob.id,
            ]),
        )
      ).code,
    ).toBe("42501");
  });
});

describe("notifications", () => {
  it("are readable only by their owner, who can mark them read but not edit them", async () => {
    await db.admin.query(
      "select app_private.notify($1, 'account_notice', 'hello alice', 'body', '{}'::jsonb)",
      [alice.id],
    );
    const mine = await db
      .as(alice.id)
      .query("select id, title, read_at from public.notifications where title = 'hello alice'");
    expect(mine.rowCount).toBe(1);
    expect(
      (await db.as(bob.id).query("select * from public.notifications where title = 'hello alice'"))
        .rowCount,
    ).toBe(0);

    const id = mine.rows[0].id;
    expect(
      (
        await db
          .as(bob.id)
          .query("update public.notifications set read_at = now() where id = $1", [id])
      ).rowCount,
    ).toBe(0);
    await db
      .as(alice.id)
      .query("update public.notifications set read_at = now() where id = $1", [id]);
    expect(
      (
        await sqlError(
          db
            .as(alice.id)
            .query("update public.notifications set title = 'rewritten' where id = $1", [id]),
        )
      ).code,
    ).toBe("42501");
  });
});

describe("rate limiting", () => {
  it("enforces a per-user fixed window", async () => {
    const results: boolean[] = [];
    for (let i = 0; i < 5; i++) {
      results.push(
        (await db.as(bob.id).query("select public.consume_rate_limit('probe', 3, 60) as ok"))
          .rows[0].ok,
      );
    }
    expect(results).toEqual([true, true, true, false, false]);
    // Another user's budget is untouched.
    expect(
      (await db.as(alice.id).query("select public.consume_rate_limit('probe', 3, 60) as ok"))
        .rows[0].ok,
    ).toBe(true);
    expect(
      (await sqlError(db.anon.query("select public.consume_rate_limit('probe', 3, 60)"))).code,
    ).toBe("42501");
  });

  it("rejects abusive parameters", async () => {
    expect(
      (
        await sqlError(
          db.as(bob.id).query("select public.consume_rate_limit('bad action!', 3, 60)"),
        )
      ).code,
    ).toBe("22023");
    expect(
      (await sqlError(db.as(bob.id).query("select public.consume_rate_limit('ok', 100000, 60)")))
        .code,
    ).toBe("22023");
  });
});

describe("audit log", () => {
  it("is append-only, even for trusted roles", async () => {
    await db.admin.query(
      "select app_private.write_audit(null, 'system', 'test.event', 'test', 'x')",
    );
    for (const sql of [
      "update public.audit_logs set action = 'tampered'",
      "delete from public.audit_logs",
      "truncate public.audit_logs",
    ]) {
      const err = await sqlError(db.admin.query(sql));
      expect(err.message, sql).toMatch(/append-only/);
      const svc = await sqlError(db.service.query(sql));
      expect(svc.message, sql).toMatch(/append-only|permission denied/);
    }
  });
});
