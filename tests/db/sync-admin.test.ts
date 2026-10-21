import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, sqlError, type Player, type TestDb } from "./helpers";

let db: TestDb;
let alice: Player;
let bob: Player;
const roles: Record<"super" | "verifier" | "moderator" | "analyst" | "nobody", string> =
  {} as never;

beforeAll(async () => {
  db = await createTestDb();
  alice = await db.onboard({ username: "alice_s", name: "Alice" });
  bob = await db.onboard({ username: "bob_s", name: "Bob" });
  const mk = async (
    role?: "super_admin" | "verification_admin" | "match_moderator" | "analyst",
  ) => {
    const u = await db.createUser();
    if (role) await db.makeAdmin(u.id, role);
    return u.id;
  };
  roles.super = await mk("super_admin");
  roles.verifier = await mk("verification_admin");
  roles.moderator = await mk("match_moderator");
  roles.analyst = await mk("analyst");
  roles.nobody = await mk();
});
afterAll(async () => {
  await db.close();
});

const game = (over: Record<string, unknown> = {}) => ({
  game_url: `https://www.chess.com/game/live/${Math.floor(Math.random() * 1e12)}`,
  game_uuid: randomUUID(),
  white_username: "alice_s",
  black_username: "bob_s",
  white_rating: 1500,
  black_rating: 1490,
  white_result: "win",
  black_result: "resigned",
  winner: "white",
  time_control: "600",
  time_class: "rapid",
  rules: "chess",
  rated: true,
  ended_at: new Date().toISOString(),
  archive_month: "2026/10",
  ...over,
});
const importGames = async (games: unknown[]) =>
  (
    await db.service.query("select public.import_chess_games($1::jsonb) as n", [
      JSON.stringify(games),
    ])
  ).rows[0].n as number;
const count = async (sql: string, params: unknown[] = []) =>
  (await db.admin.query(sql, params)).rows[0].n as number;

describe("game import (synchronisation from Chess.com archives)", () => {
  it("imports each game once, however many times or from whichever player's archive it arrives", async () => {
    const g = game();
    expect(await importGames([g])).toBe(1);
    // The opponent's archive reports the very same game.
    expect(await importGames([{ ...g }])).toBe(0);
    // Same game twice inside one batch.
    const h = game();
    expect(await importGames([h, h])).toBe(1);
    // Same Chess.com uuid under a different URL spelling is still the same game.
    expect(
      await importGames([{ ...h, game_url: "https://www.chess.com/game/live/42424242" }]),
    ).toBe(0);
    expect(await count("select count(*)::int as n from public.imported_chess_games")).toBe(2);
  });

  it("normalises usernames and never invents results", async () => {
    await importGames([
      game({
        white_username: "Alice_S",
        black_username: "BOB_S",
        winner: "mystery",
        white_result: "weird",
        black_result: "weirder",
      }),
    ]);
    const row = (
      await db.admin.query(
        "select white_username, black_username, winner from public.imported_chess_games order by imported_at desc limit 1",
      )
    ).rows[0];
    expect(row).toEqual({ white_username: "alice_s", black_username: "bob_s", winner: "unknown" });
  });

  it("skips malformed rows without losing the valid ones", async () => {
    const before = await count("select count(*)::int as n from public.imported_chess_games");
    const n = await importGames([
      game({ white_username: "bad name!" }),
      game({ game_url: "https://evil.example/game/1" }),
      game({ ended_at: null }),
      game({ white_username: "alice_s", black_username: "alice_s" }),
      game(),
    ]);
    expect(n).toBe(1);
    expect(await count("select count(*)::int as n from public.imported_chess_games")).toBe(
      before + 1,
    );
  });

  it("rejects a non-array payload and is closed to players", async () => {
    expect(
      (await sqlError(db.service.query("select public.import_chess_games('{}'::jsonb)"))).code,
    ).toBe("22023");
    expect(
      (await sqlError(db.as(alice.id).query("select public.import_chess_games('[]'::jsonb)"))).code,
    ).toBe("42501");
  });

  it("keeps imported games private to their participants and admins", async () => {
    await importGames([game({ white_username: "alice_s", black_username: "bob_s" })]);
    expect(
      (await db.as(alice.id).query("select 1 from public.imported_chess_games")).rowCount,
    ).toBeGreaterThan(0);
    expect(
      (await db.as(bob.id).query("select 1 from public.imported_chess_games")).rowCount,
    ).toBeGreaterThan(0);
    const carol = await db.onboard({ username: "carol_s" });
    expect(
      (await db.as(carol.id).query("select 1 from public.imported_chess_games")).rowCount,
    ).toBe(0);
    expect(
      (await db.as(roles.analyst).query("select 1 from public.imported_chess_games")).rowCount,
    ).toBeGreaterThan(0);
  });
});

describe("player profile and rating synchronisation", () => {
  it("stores ratings per category with their fetch time and appends history only on change", async () => {
    const rating = (r: number) =>
      JSON.stringify([
        { time_class: "rapid", rating: r, best_rating: 1700, wins: 3, losses: 2, draws: 1 },
        { time_class: "blitz", rating: 1300 },
      ]);
    const sync = (r: number) =>
      db.service.query(
        "select public.record_player_sync($1, true, null, null, null, 'https://images.chesscomfiles.com/a.png', $2::jsonb, 21600) as r",
        [alice.id, rating(r)],
      );
    expect((await sync(1500)).rows[0].r.ok).toBe(true);
    await sync(1500); // unchanged: no new history
    await sync(1520);
    const rows = (
      await db.admin.query(
        "select time_class, rating, record_wins, fetched_at from public.chess_ratings where user_id = $1 order by time_class",
        [alice.id],
      )
    ).rows;
    expect(rows.map((r) => [r.time_class, r.rating])).toEqual([
      ["blitz", 1300],
      ["rapid", 1520],
    ]);
    expect(rows[0].fetched_at).toBeTruthy();
    const history = (
      await db.admin.query(
        "select rating from public.chess_rating_history where user_id = $1 and time_class = 'rapid' order by id",
        [alice.id],
      )
    ).rows;
    expect(history.map((h) => h.rating)).toEqual([1500, 1520]);
    expect(
      (await db.admin.query("select avatar_url from public.profiles where id = $1", [alice.id]))
        .rows[0].avatar_url,
    ).toBe("https://images.chesscomfiles.com/a.png");
    const state = (
      await db.admin.query(
        "select last_success_at, error_count, last_error from public.chess_sync_state where user_id = $1",
        [alice.id],
      )
    ).rows[0];
    expect(state).toMatchObject({ error_count: 0, last_error: null });
    expect(state.last_success_at).toBeTruthy();
  });

  it("never lets a sync change a verified identity; mismatches are flagged for a human", async () => {
    const before = (
      await db.admin.query(
        "select chess_username, chess_player_id from public.chess_account_links where user_id = $1",
        [bob.id],
      )
    ).rows[0];
    const renamed = await db.service.query(
      "select public.record_player_sync($1, true, null, null, 'bob_new_name', null, $2::jsonb) as r",
      [bob.id, JSON.stringify([{ time_class: "rapid", rating: 2999 }])],
    );
    expect(renamed.rows[0].r).toMatchObject({ ok: false, anomaly: "username_changed_at_chesscom" });
    const swapped = await db.service.query(
      "select public.record_player_sync($1, true, null, $2, 'bob_s', null, '[]'::jsonb) as r",
      [bob.id, before.chess_player_id + 1],
    );
    expect(swapped.rows[0].r).toMatchObject({ ok: false, anomaly: "player_id_changed" });
    expect(
      (
        await db.admin.query(
          "select chess_username, chess_player_id from public.chess_account_links where user_id = $1",
          [bob.id],
        )
      ).rows[0],
    ).toEqual(before);
    // The suspicious payload's ratings were not applied.
    expect(
      (
        await db.admin.query(
          "select count(*)::int as n from public.chess_ratings where user_id = $1 and rating = 2999",
          [bob.id],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await db.admin.query("select last_error from public.chess_sync_state where user_id = $1", [
          bob.id,
        ])
      ).rows[0].last_error,
    ).toBe("player_id_changed");
  });

  it("backs off exponentially on failure and recovers on success", async () => {
    const carol = await db.onboard({ username: "carol_sync" });
    const wait = async () =>
      Number(
        (
          await db.admin.query(
            "select extract(epoch from next_sync_at - now()) as s from public.chess_sync_state where user_id = $1",
            [carol.id],
          )
        ).rows[0].s,
      );
    await db.service.query("select public.record_player_sync($1, false, 'HTTP 503')", [carol.id]);
    const first = await wait();
    await db.service.query("select public.record_player_sync($1, false, 'HTTP 503')", [carol.id]);
    const second = await wait();
    await db.service.query("select public.record_player_sync($1, false, 'HTTP 503')", [carol.id]);
    const third = await wait();
    expect(first).toBeGreaterThan(9 * 60);
    expect(second).toBeGreaterThan(first * 1.8);
    expect(third).toBeGreaterThan(second * 1.8);
    expect(
      (
        await db.admin.query(
          "select error_count, last_error from public.chess_sync_state where user_id = $1",
          [carol.id],
        )
      ).rows[0],
    ).toMatchObject({ error_count: 3, last_error: "HTTP 503" });
    await db.service.query(
      "select public.record_player_sync($1, true, null, null, null, null, '[]'::jsonb)",
      [carol.id],
    );
    expect(
      (
        await db.admin.query("select error_count from public.chess_sync_state where user_id = $1", [
          carol.id,
        ])
      ).rows[0].error_count,
    ).toBe(0);
  });

  it("leases due players so concurrent workers do not duplicate API calls", async () => {
    await db.admin.query(
      "update public.chess_sync_state set next_sync_at = now() - interval '1 minute'",
    );
    const first = await db.service.query("select * from public.claim_players_for_sync(100, 600)");
    expect(first.rowCount).toBeGreaterThanOrEqual(3);
    expect(
      (await db.service.query("select * from public.claim_players_for_sync(100, 600)")).rowCount,
    ).toBe(0);
  });

  it("does not sync suspended players or unlinked users", async () => {
    await db.admin.query(
      "update public.chess_sync_state set next_sync_at = now() - interval '1 minute' where user_id = $1",
      [alice.id],
    );
    await db.admin.query("update public.profiles set account_status = 'suspended' where id = $1", [
      alice.id,
    ]);
    const leased = (
      await db.service.query("select user_id from public.claim_players_for_sync(100, 60)")
    ).rows.map((r) => r.user_id);
    expect(leased).not.toContain(alice.id);
    await db.admin.query("update public.profiles set account_status = 'active' where id = $1", [
      alice.id,
    ]);
    const stranger = await db.createUser();
    expect(
      (await db.service.query("select public.record_player_sync($1, true) as r", [stranger.id]))
        .rows[0].r,
    ).toMatchObject({ ok: false, reason: "not_linked" });
  });
});

describe("administrator role matrix (enforced in the database)", () => {
  type Role = keyof typeof roles;
  const target = () => bob.id;
  // [description, sql, roles allowed to run it]
  const matrix: [string, string, Role[]][] = [
    [
      "unlink chess account",
      `select public.admin_unlink_chess_account('${randomUUID()}', 'testing role matrix')`,
      ["super", "verifier"],
    ],
    [
      "add email eligibility",
      `select public.admin_add_eligibility('email', array['matrix@example.test'], 'matrix')`,
      ["super", "verifier"],
    ],
    [
      "add domain eligibility",
      `select public.admin_add_eligibility('domain', array['matrix.example.test'], 'matrix')`,
      ["super"],
    ],
    [
      "set user eligibility",
      `select public.admin_set_user_eligibility('${randomUUID()}', 'verified', 'testing role matrix')`,
      ["super", "verifier"],
    ],
    [
      "suspend user",
      `select public.admin_set_account_status('${randomUUID()}', true, 'testing role matrix')`,
      ["super", "verifier", "moderator"],
    ],
    [
      "set role",
      `select public.admin_set_role('${randomUUID()}', 'analyst', true, 'testing role matrix')`,
      ["super"],
    ],
    [
      "update setting",
      `select public.admin_update_setting('elo_k_factor', '32'::jsonb, 'testing role matrix')`,
      ["super"],
    ],
    [
      "void challenge",
      `select public.admin_void_challenge('${randomUUID()}', 'testing role matrix')`,
      ["super", "moderator"],
    ],
    [
      "correct match",
      `select public.admin_correct_match('${randomUUID()}', 'draw', 'testing role matrix')`,
      ["super", "moderator"],
    ],
    [
      "resolve dispute",
      `select public.admin_resolve_dispute('${randomUUID()}', 'resolved', 'testing role matrix')`,
      ["super", "moderator"],
    ],
    [
      "review claim",
      `select public.admin_review_claim('${randomUUID()}', false, 'testing role matrix')`,
      ["super", "verifier"],
    ],
    [
      "retry player sync",
      `select public.admin_retry_player_sync('${randomUUID()}')`,
      ["super", "verifier", "moderator"],
    ],
    ["overview", `select public.admin_overview()`, ["super", "verifier", "moderator", "analyst"]],
  ];

  for (const [name, sql, allowed] of matrix) {
    it(`${name}: allowed for ${allowed.join(", ")} only`, async () => {
      for (const role of Object.keys(roles) as Role[]) {
        const outcome = await sqlError(db.as(roles[role]).query(sql)).catch(() => null);
        if (allowed.includes(role)) {
          // Allowed roles get past authorisation; any failure must be a business-rule error, never 42501.
          expect(
            outcome === null || outcome.code !== "42501",
            `${role} should pass authorisation for ${name}`,
          ).toBe(true);
        } else {
          expect(outcome?.code, `${role} must be denied ${name}`).toBe("42501");
        }
      }
      void target;
    });
  }
});

describe("role management and audit trail", () => {
  it("lets only super admins grant roles, requires a reason, and logs actor/target/reason/time", async () => {
    const newcomer = await db.createUser();
    expect(
      (
        await sqlError(
          db
            .as(roles.verifier)
            .query("select public.admin_set_role($1, 'analyst', true, 'I would like help')", [
              newcomer.id,
            ]),
        )
      ).code,
    ).toBe("42501");
    expect(
      (
        await sqlError(
          db
            .as(roles.super)
            .query("select public.admin_set_role($1, 'analyst', true, '')", [newcomer.id]),
        )
      ).code,
    ).toBe("22023");

    await db
      .as(roles.super)
      .query(
        "select public.admin_set_role($1, 'analyst', true, 'Joined the committee as treasurer')",
        [newcomer.id],
      );
    expect((await db.as(newcomer.id).query("select role from public.admin_roles")).rows).toEqual([
      { role: "analyst" },
    ]);
    const log = (
      await db.admin.query(
        "select actor_id, actor_kind, action, target_type, target_id, reason, created_at from public.audit_logs where action = 'role.granted' and target_id = $1",
        [newcomer.id],
      )
    ).rows[0];
    expect(log).toMatchObject({
      actor_id: roles.super,
      actor_kind: "admin",
      action: "role.granted",
      target_type: "profile",
      reason: "Joined the committee as treasurer",
    });
    expect(log.created_at).toBeInstanceOf(Date);

    await db
      .as(roles.super)
      .query("select public.admin_set_role($1, 'analyst', false, 'Left the committee')", [
        newcomer.id,
      ]);
    expect((await db.as(newcomer.id).query("select role from public.admin_roles")).rowCount).toBe(
      0,
    );
  });

  it("shows other admins' role assignments only to super admins", async () => {
    expect(
      (await db.as(roles.analyst).query("select user_id from public.admin_roles")).rows.map(
        (r) => r.user_id,
      ),
    ).toEqual([roles.analyst]);
    expect(
      (await db.as(roles.verifier).query("select user_id from public.admin_roles")).rowCount,
    ).toBe(1);
    expect(
      (await db.as(roles.super).query("select user_id from public.admin_roles")).rowCount,
    ).toBeGreaterThanOrEqual(4);
  });

  it("protects against self-escalation and lock-out", async () => {
    expect(
      (
        await sqlError(
          db
            .as(roles.super)
            .query("select public.admin_set_role($1, 'analyst', true, 'changing myself here')", [
              roles.super,
            ]),
        )
      ).message,
    ).toMatch(/your own roles/);
    const second = await db.createUser();
    await db
      .as(roles.super)
      .query(
        "select public.admin_set_role($1, 'super_admin', true, 'Second super admin for continuity')",
        [second.id],
      );
    await db
      .as(second.id)
      .query(
        "select public.admin_set_role($1, 'super_admin', false, 'Stepping down the original admin')",
        [roles.super],
      );
    // Only one super admin remains: removal is refused.
    expect(
      (
        await sqlError(
          db
            .as(roles.super)
            .query(
              "select public.admin_set_role($1, 'super_admin', false, 'removing the last one')",
              [second.id],
            ),
        )
      ).code,
    ).toBe("42501");
    const err = await sqlError(
      db.admin.query(
        "select public.admin_set_role('00000000-0000-0000-0000-000000000000', 'super_admin', false, 'x')",
      ),
    );
    expect(err.code).toBeDefined();
    await db.makeAdmin(roles.super, "super_admin"); // restore for later tests
  });

  it("bootstraps the first super admin only through the service role", async () => {
    const founder = await db.createUser({ email: "founder@example.test" });
    expect(
      (
        await sqlError(
          db.as(founder.id).query("select public.bootstrap_super_admin('founder@example.test')"),
        )
      ).code,
    ).toBe("42501");
    expect(
      (await sqlError(db.anon.query("select public.bootstrap_super_admin('founder@example.test')")))
        .code,
    ).toBe("42501");
    expect(
      (
        await sqlError(
          db.service.query("select public.bootstrap_super_admin('nobody@example.test')"),
        )
      ).message,
    ).toMatch(/sign in with Google once/);
    await db.service.query("select public.bootstrap_super_admin('Founder@Example.test')");
    expect(
      (
        await db
          .as(founder.id)
          .query("select role from public.admin_roles where user_id = $1", [founder.id])
      ).rows,
    ).toEqual([{ role: "super_admin" }]);
    const log = (
      await db.admin.query(
        "select actor_id, actor_kind from public.audit_logs where action = 'role.bootstrap_super_admin' and target_id = $1",
        [founder.id],
      )
    ).rows[0];
    expect(log).toEqual({ actor_id: null, actor_kind: "system" });
  });

  it("only admins can read audit logs and the job history", async () => {
    expect((await db.as(roles.nobody).query("select 1 from public.audit_logs")).rowCount).toBe(0);
    expect(
      (await db.as(roles.analyst).query("select 1 from public.audit_logs")).rowCount,
    ).toBeGreaterThan(0);
    await db.service.query(
      "select public.finish_job_run(public.start_job_run('sync-profiles'), 'ok', '{\"players\":3}'::jsonb)",
    );
    expect((await db.as(roles.nobody).query("select 1 from public.job_runs")).rowCount).toBe(0);
    expect(
      (await db.as(roles.moderator).query("select job, status from public.job_runs")).rows,
    ).toEqual([{ job: "sync-profiles", status: "ok" }]);
  });
});

describe("eligibility, suspension and settings administration", () => {
  it("manages the allowlist with audit entries; domain rules are super-admin only", async () => {
    const auditCount = () =>
      count(
        "select count(*)::int as n from public.audit_logs where action in ('eligibility.entries_added', 'eligibility.entry_revoked')",
      );
    const auditBefore = await auditCount();
    const added = await db
      .as(roles.verifier)
      .query(
        "select public.admin_add_eligibility('email', array['  New.Student@Example.test ', 'second@example.test'], 'Batch 2026') as n",
      );
    expect(added.rows[0].n).toBe(2);
    expect(
      await count(
        "select count(*)::int as n from public.student_eligibility where value = 'new.student@example.test'",
      ),
    ).toBe(1);
    expect(
      (
        await sqlError(
          db
            .as(roles.verifier)
            .query(
              "select public.admin_add_eligibility('domain', array['all.example.test'], 'too broad')",
            ),
        )
      ).code,
    ).toBe("42501");
    await db
      .as(roles.super)
      .query(
        "select public.admin_add_eligibility('domain', array['campus.example.test'], 'Institute-managed Google accounts')",
      );

    const entry = (
      await db.admin.query(
        "select id from public.student_eligibility where value = 'second@example.test'",
      )
    ).rows[0];
    await db
      .as(roles.verifier)
      .query("select public.admin_remove_eligibility($1, 'Left the institute')", [entry.id]);
    const stranger = await db.createUser({ email: "second@example.test" });
    expect(
      (await db.as(stranger.id).query("select public.claim_eligibility() as s")).rows[0].s,
    ).toBe("unverified");
    // Granted-but-filtered: a student sees no allowlist rows at all.
    expect(
      (await db.as(stranger.id).query("select * from public.student_eligibility")).rowCount,
    ).toBe(0);
    // One entry each for: email batch added, domain rule added, entry revoked.
    expect((await auditCount()) - auditBefore).toBe(3);
  });

  it("reviews eligibility requests from students who are not on the list", async () => {
    const student = await db.createUser({ email: "unlisted@gmail.example.test" });
    const req = await db
      .as(student.id)
      .query(
        "select * from public.request_eligibility_review('2023CA45 / roll number', 'My college mail is not forwarding')",
      );
    expect(req.rows[0].status).toBe("open");
    expect(
      (
        await sqlError(
          db.as(student.id).query("select * from public.request_eligibility_review('again', null)"),
        )
      ).message,
    ).toMatch(/open eligibility request/);
    expect(
      (
        await sqlError(
          db
            .as(roles.moderator)
            .query(
              "select * from public.admin_review_eligibility_request($1, true, 'moderators cannot do this')",
              [req.rows[0].id],
            ),
        )
      ).code,
    ).toBe("42501");
    await db
      .as(roles.verifier)
      .query(
        "select * from public.admin_review_eligibility_request($1, true, 'Roll number matches the department list')",
        [req.rows[0].id],
      );
    expect(
      (
        await db.admin.query(
          "select eligibility_status, eligibility_source from public.profiles where id = $1",
          [student.id],
        )
      ).rows[0],
    ).toEqual({ eligibility_status: "verified", eligibility_source: "admin_approval" });
  });

  it("suspends and reinstates with notifications, and an admin cannot suspend themselves", async () => {
    await db
      .as(roles.moderator)
      .query(
        "select public.admin_set_account_status($1, true, 'Repeated abusive messages in challenges')",
        [alice.id],
      );
    expect(
      (
        await db.admin.query(
          "select account_status, is_approved from public.profiles where id = $1",
          [alice.id],
        )
      ).rows[0],
    ).toEqual({ account_status: "suspended", is_approved: false });
    expect(
      (
        await db
          .as(alice.id)
          .query("select title from public.notifications where type = 'account_notice'")
      ).rows[0].title,
    ).toBe("Account suspended");
    // A suspended player can no longer start challenges.
    expect(
      (
        await sqlError(
          db
            .as(alice.id)
            .query(
              "insert into public.challenges (recipient_id, time_control) values ($1, '600')",
              [bob.id],
            ),
        )
      ).message,
    ).toMatch(/challenger_not_approved/);
    await db
      .as(roles.moderator)
      .query(
        "select public.admin_set_account_status($1, false, 'Warning acknowledged, reinstated')",
        [alice.id],
      );
    expect(
      (await db.admin.query("select is_approved from public.profiles where id = $1", [alice.id]))
        .rows[0].is_approved,
    ).toBe(true);
    expect(
      (
        await sqlError(
          db
            .as(roles.moderator)
            .query("select public.admin_set_account_status($1, true, 'suspending myself')", [
              roles.moderator,
            ]),
        )
      ).message,
    ).toMatch(/your own account/);
  });

  it("changes settings with type checks and a before/after audit entry", async () => {
    expect(
      (
        await sqlError(
          db
            .as(roles.super)
            .query(
              "select public.admin_update_setting('elo_k_factor', '\"high\"'::jsonb, 'wrong type')",
            ),
        )
      ).code,
    ).toBe("22023");
    expect(
      (
        await sqlError(
          db
            .as(roles.super)
            .query("select public.admin_update_setting('nope', '1'::jsonb, 'unknown key here')"),
        )
      ).code,
    ).toBe("P0002");
    expect(
      (
        await sqlError(
          db
            .as(roles.super)
            .query(
              "select public.admin_update_setting('elo_k_factor', '-4'::jsonb, 'negative value')",
            ),
        )
      ).code,
    ).toBe("22023");
    await db
      .as(roles.super)
      .query(
        "select public.admin_update_setting('challenge_expiry_hours', '24'::jsonb, 'Shorter expiry for tournament week')",
      );
    const log = (
      await db.admin.query(
        "select before_data, after_data, reason from public.audit_logs where action = 'setting.updated' and target_id = 'challenge_expiry_hours'",
      )
    ).rows[0];
    expect(log).toMatchObject({
      before_data: { value: 48 },
      after_data: { value: 24 },
      reason: "Shorter expiry for tournament week",
    });
    await db
      .as(roles.super)
      .query(
        "select public.admin_update_setting('challenge_expiry_hours', '48'::jsonb, 'Tournament week is over')",
      );
  });

  it("reports aggregate overview numbers to every admin role", async () => {
    const o = (await db.as(roles.analyst).query("select public.admin_overview() as o")).rows[0].o;
    expect(o.players.accounts).toBeGreaterThanOrEqual(5);
    expect(o.players.approved).toBeGreaterThanOrEqual(3);
    expect(o.queues).toHaveProperty("claims_needing_review");
    expect(o.sync.players_with_errors).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(o.sync.last_runs)).toBe(true);
  });
});
