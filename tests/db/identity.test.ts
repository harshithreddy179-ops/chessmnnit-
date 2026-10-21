import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { adminUrl } from "./global-setup";
import { createTestDb, sqlError, type TestDb } from "./helpers";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.close();
});

async function startClaim(userId: string, username: string) {
  const r = await db.as(userId).query<{ id: string; verification_code: string; chess_username: string }>(
    "select * from public.start_chess_claim($1)",
    [username],
  );
  return r.rows[0]!;
}

async function confirm(claimId: string, username: string, playerId: number | null = null) {
  const r = await db.service.query<{ r: { ok: boolean; reason?: string } }>(
    "select public.confirm_chess_link($1, $2, $3, 'profile_code') as r",
    [claimId, username, playerId],
  );
  return r.rows[0]!.r;
}

async function eligibleUser() {
  const u = await db.createUser();
  await db.allowEmail(u.email);
  await db.as(u.id).query("select public.claim_eligibility()");
  return u;
}

describe("onboarding produces an honest, approved public player", () => {
  it("tracks the four statuses independently", async () => {
    const u = await db.createUser({ name: "Asha Verma" });
    const profile = async () =>
      (await db.admin.query("select eligibility_status, onboarding_completed_at, is_approved from public.profiles where id = $1", [u.id])).rows[0];

    expect(await profile()).toMatchObject({ eligibility_status: "unverified", is_approved: false });

    // Not on the allowlist -> eligibility stays unverified.
    expect((await db.as(u.id).query("select public.claim_eligibility() as s")).rows[0].s).toBe("unverified");

    await db.allowEmail(u.email);
    expect((await db.as(u.id).query("select public.claim_eligibility() as s")).rows[0].s).toBe("verified");
    expect(await profile()).toMatchObject({ eligibility_status: "verified", is_approved: false });

    const claim = await startClaim(u.id, "AshaV_Chess");
    expect(claim.chess_username).toBe("ashav_chess"); // normalized
    expect((await confirm(claim.id, "ashav_chess", 4242)).ok).toBe(true);
    // Chess.com verified but profile not complete yet -> still not approved.
    expect(await profile()).toMatchObject({ is_approved: false });

    await db.as(u.id).query("select public.complete_onboarding()");
    expect(await profile()).toMatchObject({ is_approved: true });
  });

  it("never exposes email addresses to the public API", async () => {
    const p = await db.onboard({ name: "Public Player" });
    const visible = await db.anon.query("select * from public.profiles where id = $1", [p.id]);
    expect(visible.rowCount).toBe(1);
    expect(JSON.stringify(visible.rows[0])).not.toContain(p.email);
    expect((await sqlError(db.anon.query("select email from auth.users"))).code).toBe("42501");
    expect((await sqlError(db.as(p.id).query("select email from auth.users"))).code).toBe("42501");
  });

  it("does not use the email local-part as the default display name", async () => {
    const u = await db.createUser({ email: "secret.roll.2023ca99@example.test" });
    const row = (await db.admin.query("select display_name from public.profiles where id = $1", [u.id])).rows[0];
    expect(row.display_name).toBe("New player");
  });
});

describe("student eligibility allowlist", () => {
  it("requires a confirmed Google email", async () => {
    const u = await db.createUser({ confirmed: false });
    await db.allowEmail(u.email);
    expect((await db.as(u.id).query("select public.claim_eligibility() as s")).rows[0].s).toBe("unverified");
  });

  it("supports admin-managed domain rules, and revoked entries stop matching", async () => {
    const u = await db.createUser({ email: "someone@campus.example.test" });
    expect((await db.as(u.id).query("select public.claim_eligibility() as s")).rows[0].s).toBe("unverified");

    await db.admin.query("insert into public.student_eligibility (kind, value) values ('domain', 'campus.example.test')");
    expect((await db.as(u.id).query("select public.claim_eligibility() as s")).rows[0].s).toBe("verified");

    const v = await db.createUser({ email: "other@revoked.example.test" });
    await db.admin.query("insert into public.student_eligibility (kind, value, revoked_at) values ('domain', 'revoked.example.test', now())");
    expect((await db.as(v.id).query("select public.claim_eligibility() as s")).rows[0].s).toBe("unverified");
  });

  it("blocks Chess.com claims until eligibility is verified", async () => {
    const u = await db.createUser();
    const err = await sqlError(db.as(u.id).query("select * from public.start_chess_claim('someone')"));
    expect(err.message).toMatch(/eligibility_required/);
  });

  it("rejects malformed usernames", async () => {
    const u = await eligibleUser();
    for (const bad of ["ab", "has space", "x".repeat(26), "bad!char", ""]) {
      const err = await sqlError(db.as(u.id).query("select * from public.start_chess_claim($1)", [bad]));
      expect(err.message).toMatch(/invalid_username/);
    }
  });
});

describe("strict one-to-one ownership", () => {
  it("one Google account cannot link two Chess.com accounts", async () => {
    const p = await db.onboard();
    const err = await sqlError(db.as(p.id).query("select * from public.start_chess_claim('another_account')"));
    expect(err.message).toMatch(/already_linked/);

    // Even writing straight to the table (trusted role) hits the UNIQUE constraint.
    const direct = await sqlError(
      db.service.query(
        "insert into public.chess_account_links (user_id, chess_username, verification_method) values ($1, 'second_one', 'admin_review')",
        [p.id],
      ),
    );
    expect(direct.code).toBe("23505");
    expect(direct.message).toMatch(/chess_account_links_user_id_key/);
  });

  it("one Chess.com account cannot be claimed by two Google accounts", async () => {
    const owner = await db.onboard({ username: "contested_name" });
    const rival = await eligibleUser();

    // Anyone may START a claim (it confers nothing, so nobody can squat a username)...
    const claim = await startClaim(rival.id, "contested_name");
    // ...but it can never be confirmed while the owner holds the link.
    const result = await confirm(claim.id, "contested_name", 99);
    expect(result).toMatchObject({ ok: false, reason: "chess_account_already_linked" });

    const after = (await db.admin.query("select status, review_reason from public.chess_link_claims where id = $1", [claim.id])).rows[0];
    expect(after).toMatchObject({ status: "rejected", review_reason: "chess_account_already_linked" });
    const links = await db.admin.query("select user_id from public.chess_account_links where chess_username = 'contested_name'");
    expect(links.rows.map((r) => r.user_id)).toEqual([owner.id]);

    // The rival is told, and is not approved.
    const note = await db.as(rival.id).query("select type, title from public.notifications");
    expect(note.rows.some((n) => n.type === "verification_result")).toBe(true);
    expect((await db.admin.query("select is_approved from public.profiles where id = $1", [rival.id])).rows[0].is_approved).toBe(false);
  });

  it("the same Chess.com player id cannot back two links (rename-proof)", async () => {
    const a = await db.onboard({ playerId: 777001 });
    const u = await eligibleUser();
    const claim = await startClaim(u.id, "renamed_same_person");
    const r = await confirm(claim.id, "renamed_same_person", a.playerId);
    expect(r).toMatchObject({ ok: false, reason: "chess_account_already_linked" });
  });

  it("is safe under concurrent claims: one winner, one clean rejection", async () => {
    // Deterministic interleaving: the first confirmation holds its transaction open while
    // the second one starts; the second must block on the unique index, then lose.
    const u1 = await eligibleUser();
    const u2 = await eligibleUser();
    const c1 = await startClaim(u1.id, "race_target");
    const c2 = await startClaim(u2.id, "race_target");

    const tx1 = new Client({ connectionString: adminUrl(db.name) });
    const tx2 = new Client({ connectionString: adminUrl(db.name) });
    await tx1.connect();
    await tx2.connect();
    try {
      await tx1.query("begin");
      await tx1.query("set local role service_role");
      const first = await tx1.query("select public.confirm_chess_link($1, 'race_target', 1001, 'profile_code') as r", [c1.id]);
      expect(first.rows[0].r.ok).toBe(true);

      await tx2.query("begin");
      await tx2.query("set local role service_role");
      let settled = false;
      const second = tx2
        .query("select public.confirm_chess_link($1, 'race_target', 1002, 'profile_code') as r", [c2.id])
        .then((r) => {
          settled = true;
          return r;
        });
      await new Promise((r) => setTimeout(r, 400));
      expect(settled).toBe(false); // blocked on the row the first transaction inserted

      await tx1.query("commit");
      const res = await second;
      expect(res.rows[0].r).toMatchObject({ ok: false, reason: "chess_account_already_linked" });
      await tx2.query("commit");
    } finally {
      await tx1.end();
      await tx2.end();
    }

    const owners = await db.admin.query("select user_id from public.chess_account_links where chess_username = 'race_target'");
    expect(owners.rows).toEqual([{ user_id: u1.id }]);
  });

  it("many simultaneous claimants still yield exactly one owner", async () => {
    const users = await Promise.all(Array.from({ length: 6 }, () => eligibleUser()));
    const claims = await Promise.all(users.map((u) => startClaim(u.id, "crowded_name")));
    const results = await Promise.all(claims.map((c, i) => confirm(c.id, "crowded_name", 5000 + i)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).every((r) => r.reason === "chess_account_already_linked")).toBe(true);
    const owners = await db.admin.query("select count(*)::int as n from public.chess_account_links where chess_username = 'crowded_name'");
    expect(owners.rows[0].n).toBe(1);
  });

  it("a user who gets linked while holding an older claim cannot be double-linked", async () => {
    const u = await eligibleUser();
    const claim = await startClaim(u.id, "first_choice");
    await db.admin.query(
      "insert into public.chess_account_links (user_id, chess_username, verification_method) values ($1, 'slipped_in', 'admin_review')",
      [u.id],
    );
    const r = await confirm(claim.id, "first_choice", 31337);
    expect(r).toMatchObject({ ok: false, reason: "user_already_linked" });
  });

  it("refuses to confirm when the observed username does not match the claim", async () => {
    const u = await eligibleUser();
    const claim = await startClaim(u.id, "claimed_name");
    expect(await confirm(claim.id, "someone_else", 1)).toMatchObject({ ok: false, reason: "username_mismatch" });
  });

  it("cannot confirm an expired claim", async () => {
    const u = await eligibleUser();
    const claim = await startClaim(u.id, "slow_player");
    await db.admin.query("update public.chess_link_claims set code_expires_at = now() - interval '1 minute' where id = $1", [claim.id]);
    expect(await confirm(claim.id, "slow_player", 2)).toMatchObject({ ok: false, reason: "claim_expired" });
  });
});

describe("verified identity is immutable to students", () => {
  it("denies any direct write to chess_account_links", async () => {
    const p = await db.onboard({ username: "locked_in" });
    const other = await eligibleUser();
    for (const sql of [
      "update public.chess_account_links set chess_username = 'hijacked' where user_id = $1",
      "delete from public.chess_account_links where user_id = $1",
      "insert into public.chess_account_links (user_id, chess_username, verification_method) values ($1, 'forged_link', 'admin_review')",
    ]) {
      expect((await sqlError(db.as(p.id).query(sql, [p.id]))).code).toBe("42501");
    }
    // Nor can someone else insert a link pointing at their own id.
    expect(
      (await sqlError(db.as(other.id).query("insert into public.chess_account_links (user_id, chess_username, verification_method) values ($1, 'self_issued', 'admin_review')", [other.id]))).code,
    ).toBe("42501");
    const row = (await db.admin.query("select chess_username from public.chess_account_links where user_id = $1", [p.id])).rows[0];
    expect(row.chess_username).toBe("locked_in");
  });

  it("is also immutable for trusted roles: relinking must go through unlink + re-verification", async () => {
    const p = await db.onboard({ username: "stable_name", playerId: 8080 });
    for (const sql of [
      "update public.chess_account_links set chess_username = 'renamed' where user_id = $1",
      "update public.chess_account_links set user_id = gen_random_uuid() where user_id = $1",
      "update public.chess_account_links set chess_player_id = 1 where user_id = $1",
    ]) {
      const err = await sqlError(db.service.query(sql, [p.id]));
      expect(err.message).toMatch(/immutable|foreign key/);
    }
  });

  it("refuses a new claim while a verified link exists", async () => {
    const p = await db.onboard();
    expect((await sqlError(db.as(p.id).query("select * from public.start_chess_claim('brand_new')"))).message).toMatch(/already_linked/);
  });

  it("generates verification codes in the database; clients cannot supply or confirm them", async () => {
    const u = await eligibleUser();
    const a = await startClaim(u.id, "code_probe");
    const b = await startClaim(u.id, "code_probe");
    expect(a.verification_code).toMatch(/^MNNIT-[A-HJKMNP-Z2-9]{8}$/);
    expect(b.verification_code).not.toBe(a.verification_code);

    expect((await sqlError(db.as(u.id).query("insert into public.chess_link_claims (user_id, chess_username, verification_code) values ($1, 'x_forge', 'hello')", [u.id]))).code).toBe("42501");
    expect((await sqlError(db.as(u.id).query("update public.chess_link_claims set verification_code = 'hello' where user_id = $1", [u.id]))).code).toBe("42501");
    expect((await sqlError(db.as(u.id).query("select public.confirm_chess_link($1, 'code_probe', 1, 'profile_code')", [b.id]))).code).toBe("42501");
    expect((await sqlError(db.anon.query("select public.confirm_chess_link($1, 'code_probe', 1, 'profile_code')", [b.id]))).code).toBe("42501");
    // Starting a new claim supersedes the old one: a single open claim per user.
    const open = await db.admin.query("select count(*)::int as n from public.chess_link_claims where user_id = $1 and status in ('pending','needs_review')", [u.id]);
    expect(open.rows[0].n).toBe(1);
  });

  it("does not offer OAuth until Chess.com has approved the application", async () => {
    const u = await eligibleUser();
    const err = await sqlError(db.as(u.id).query("select * from public.start_chess_claim('oauth_try', 'oauth')"));
    expect(err.message).toMatch(/oauth_unavailable/);
  });
});

describe("only complete, verified, active players are public", () => {
  it("hides unverified, incomplete and suspended accounts from public data", async () => {
    const verified = await db.onboard({ username: "listed_player" });

    const pending = await eligibleUser();
    await startClaim(pending.id, "pending_player"); // claim only, never verified

    const unfinished = await eligibleUser();
    const c = await startClaim(unfinished.id, "unfinished_player");
    await confirm(c.id, "unfinished_player", 123456); // verified but onboarding not completed

    const suspended = await db.onboard({ username: "suspended_player" });
    await db.admin.query("update public.profiles set account_status = 'suspended' where id = $1", [suspended.id]);

    const names = async () =>
      (await db.anon.query("select chess_username from public.get_leaderboard('chesscom_rating', 'rapid', 100, 0)")).rows.map((r) => r.chess_username);
    // Give everyone a rating so only approval, not rating absence, decides visibility.
    for (const u of [verified, suspended]) {
      await db.service.query("select public.record_player_sync($1, true, null, null, null, null, $2::jsonb, 3600)", [
        u.id,
        JSON.stringify([{ time_class: "rapid", rating: 1500 }]),
      ]);
    }
    await db.admin.query("insert into public.chess_ratings (user_id, time_class, rating) values ($1, 'rapid', 1800), ($2, 'rapid', 1900) on conflict do nothing", [pending.id, unfinished.id]);

    const hidden = ["pending_player", "unfinished_player", "suspended_player"];
    const listed = await names();
    expect(listed).toContain("listed_player");
    for (const h of hidden) expect(listed).not.toContain(h);

    const dir = (await db.anon.query("select chess_username from public.get_player_directory(null, 'rapid', null, null, null, false, 'name', 100, 0)")).rows.map((r) => r.chess_username);
    expect(dir).toContain("listed_player");
    for (const h of hidden) expect(dir).not.toContain(h);

    const links = (await db.anon.query("select chess_username from public.chess_account_links")).rows.map((r) => r.chess_username);
    expect(links).toContain("listed_player");
    for (const h of hidden) expect(links).not.toContain(h);

    const profiles = (await db.anon.query("select id from public.profiles")).rows.map((r) => r.id);
    expect(profiles).toContain(verified.id);
    for (const u of [pending, unfinished, suspended]) expect(profiles).not.toContain(u.id);

    // Ratings of unapproved players are not readable either.
    const ratings = (await db.anon.query("select user_id from public.chess_ratings")).rows.map((r) => r.user_id);
    expect(ratings).toContain(verified.id);
    for (const u of [pending, unfinished, suspended]) expect(ratings).not.toContain(u.id);
  });
});

describe("admin-reviewed fallback and account recovery", () => {
  it("lets a verification admin approve a manually reviewed claim, with an audit trail", async () => {
    const u = await eligibleUser();
    const admin = await db.createUser();
    await db.makeAdmin(admin.id, "verification_admin");
    await startClaim(u.id, "manual_case");
    const review = await db.as(u.id).query("select * from public.submit_claim_for_review('I met the admins at the chess club room and can show the account')");
    expect(review.rows[0].status).toBe("needs_review");

    const res = await db.as(admin.id).query("select public.admin_review_claim($1, true, 'Verified in person at the club room', 555) as r", [review.rows[0].id]);
    expect(res.rows[0].r.ok).toBe(true);
    const link = (await db.admin.query("select verification_method, chess_player_id from public.chess_account_links where user_id = $1", [u.id])).rows[0];
    expect(link).toMatchObject({ verification_method: "admin_review" });
    const audit = await db.admin.query("select actor_id, action, reason from public.audit_logs where action = 'chess_link.verified' and target_id = $1", [review.rows[0].id]);
    expect(audit.rows[0]).toMatchObject({ actor_id: admin.id, reason: "Verified in person at the club room" });
  });

  it("recovery approval frees a username but never grants it", async () => {
    const holder = await db.onboard({ username: "lost_access" });
    const claimant = await eligibleUser();
    const admin = await db.createUser();
    await db.makeAdmin(admin.id, "verification_admin");

    const req = await db.as(claimant.id).query(
      "select * from public.request_account_recovery('transfer_username', 'lost_access', 'My old Google account was deactivated when I graduated')",
    );
    const approved = await db.as(admin.id).query("select * from public.admin_resolve_recovery($1, true, 'Confirmed identity with the old roll number')", [req.rows[0].id]);
    expect(approved.rows[0].status).toBe("approved");

    expect((await db.admin.query("select count(*)::int as n from public.chess_account_links where user_id = $1", [holder.id])).rows[0].n).toBe(0);
    expect((await db.admin.query("select is_approved from public.profiles where id = $1", [holder.id])).rows[0].is_approved).toBe(false);
    const history = await db.admin.query("select chess_username, unlinked_by from public.chess_link_history where user_id = $1", [holder.id]);
    expect(history.rows[0]).toMatchObject({ chess_username: "lost_access", unlinked_by: admin.id });

    // The claimant still has to prove ownership through normal verification.
    expect((await db.admin.query("select count(*)::int as n from public.chess_account_links where user_id = $1", [claimant.id])).rows[0].n).toBe(0);
    const claim = await startClaim(claimant.id, "lost_access");
    expect((await confirm(claim.id, "lost_access", 4321)).ok).toBe(true);
  });

  it("only verification admins can resolve recovery requests", async () => {
    const claimant = await eligibleUser();
    const req = await db.as(claimant.id).query("select * from public.request_account_recovery('change_username', 'new_handle', 'I changed my handle and need to relink')");
    const analyst = await db.createUser();
    await db.makeAdmin(analyst.id, "analyst");
    for (const actor of [claimant.id, analyst.id]) {
      expect((await sqlError(db.as(actor).query("select * from public.admin_resolve_recovery($1, true, 'trying my luck')", [req.rows[0].id]))).code).toBe("42501");
    }
  });
});
