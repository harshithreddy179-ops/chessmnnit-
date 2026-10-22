import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, sqlError, type TestDb } from "./helpers";

let db: TestDb;
let verifier: string;
let moderator: string;
beforeAll(async () => {
  db = await createTestDb();
  verifier = (await db.createUser()).id;
  await db.makeAdmin(verifier, "verification_admin");
  moderator = (await db.createUser()).id;
  await db.makeAdmin(moderator, "match_moderator");
});
afterAll(async () => {
  await db.close();
});

interface LinkResult {
  ok: boolean;
  reason?: string;
  chess_username?: string;
}

async function link(userId: string, username: string): Promise<LinkResult> {
  const r = await db
    .as(userId)
    .query<{ r: LinkResult }>("select public.link_my_chess_account($1) as r", [username]);
  return r.rows[0]!.r;
}

const profile = async (id: string) =>
  (
    await db.admin.query(
      "select eligibility_status, eligibility_source, onboarding_completed_at, is_approved from public.profiles where id = $1",
      [id],
    )
  ).rows[0];

const linkRow = async (id: string) =>
  (await db.admin.query("select * from public.chess_account_links where user_id = $1", [id]))
    .rows[0];

describe("open registration (the default)", () => {
  it("starts every account eligible, with no student list involved", async () => {
    const u = await db.createUser({ email: "anyone@gmail.example.test" });
    expect(await profile(u.id)).toMatchObject({
      eligibility_status: "verified",
      eligibility_source: "open_registration",
    });
  });

  it("lists a player once they have linked a username and finished onboarding", async () => {
    const u = await db.createUser({ name: "Asha Verma" });
    expect(await profile(u.id)).toMatchObject({ is_approved: false });

    expect(await link(u.id, "  AshaV_Chess ")).toEqual({ ok: true, chess_username: "ashav_chess" });
    // Linked, but onboarding is not finished.
    expect(await profile(u.id)).toMatchObject({ is_approved: false });

    await db.as(u.id).query("select public.complete_onboarding()");
    expect(await profile(u.id)).toMatchObject({ is_approved: true });
  });

  it("records the link honestly: self-declared, never as verified ownership", async () => {
    const u = await db.createUser();
    await link(u.id, "honest_link");
    expect(await linkRow(u.id)).toMatchObject({
      chess_username: "honest_link",
      verification_method: "self_declared",
      chess_player_id: null,
    });
    const audit = await db.admin.query(
      "select actor_kind from public.audit_logs where action = 'chess_link.self_declared' and target_id = $1",
      [u.id],
    );
    expect(audit.rows).toEqual([{ actor_kind: "user" }]);
  });
});

describe("linking a Chess.com username", () => {
  it("rejects malformed usernames before touching anything", async () => {
    const u = await db.createUser();
    for (const bad of ["ab", "has space", "x".repeat(26), "bad!char", ""]) {
      expect(
        (await sqlError(db.as(u.id).query("select public.link_my_chess_account($1)", [bad]))).code,
      ).toBe("22023");
    }
    expect(await linkRow(u.id)).toBeUndefined();
  });

  it("keeps the one-to-one rule: a username belongs to one member", async () => {
    const first = await db.createUser();
    const second = await db.createUser();
    expect((await link(first.id, "contested_name")).ok).toBe(true);
    // Case and padding do not make it a different account.
    expect(await link(second.id, " Contested_Name")).toEqual({
      ok: false,
      reason: "chess_account_already_linked",
    });
    expect(await linkRow(second.id)).toBeUndefined();
    expect((await linkRow(first.id)).chess_username).toBe("contested_name");
  });

  it("does not let a member change their own link; that is an administrator's job", async () => {
    const u = await db.createUser();
    await link(u.id, "first_choice");
    const err = await sqlError(
      db.as(u.id).query("select public.link_my_chess_account('second_choice')"),
    );
    expect(err.message).toMatch(/already_linked/);
    expect((await linkRow(u.id)).chess_username).toBe("first_choice");
  });

  it("refuses suspended accounts and signed-out callers", async () => {
    const u = await db.createUser();
    await db.admin.query("update public.profiles set account_status = 'suspended' where id = $1", [
      u.id,
    ]);
    expect(
      (await sqlError(db.as(u.id).query("select public.link_my_chess_account('suspended_one')")))
        .code,
    ).toBe("42501");
    expect(
      (await sqlError(db.anon.query("select public.link_my_chess_account('anon_name')"))).code,
    ).toBe("42501");
  });

  it("is rate limited", async () => {
    const u = await db.createUser();
    // Ten failed attempts (the username is taken) use up the hourly allowance.
    const holder = await db.createUser();
    await link(holder.id, "rate_limit_holder");
    for (let i = 0; i < 10; i++) await link(u.id, "rate_limit_holder");
    expect(
      (await sqlError(db.as(u.id).query("select public.link_my_chess_account('rate_limit_other')")))
        .code,
    ).toBe("53400");
  });

  it("cancels a claim left over from the older verification flow", async () => {
    const u = await db.createUser();
    await db.as(u.id).query("select * from public.start_chess_claim('legacy_claim')");
    await link(u.id, "legacy_claim");
    const claim = (
      await db.admin.query("select status from public.chess_link_claims where user_id = $1", [u.id])
    ).rows[0];
    expect(claim.status).toBe("cancelled");
  });
});

describe("the student-list requirement is still available as a setting", () => {
  it("applies to accounts created while it is on, and not to existing ones", async () => {
    const before = await db.createUser();
    await db.requireEligibility(true);
    const gated = await db.createUser({ email: "gated@gmail.example.test" });
    await db.requireEligibility(false);
    const after = await db.createUser();

    expect((await profile(before.id)).eligibility_status).toBe("verified");
    expect((await profile(gated.id)).eligibility_status).toBe("unverified");
    expect((await profile(after.id)).eligibility_status).toBe("verified");

    const err = await sqlError(
      db.as(gated.id).query("select public.link_my_chess_account('gated_one')"),
    );
    expect(err.message).toMatch(/eligibility_required/);

    // The original path still works for gated accounts: being on the list unlocks linking.
    await db.allowEmail(gated.email);
    await db.as(gated.id).query("select public.claim_eligibility()");
    expect((await link(gated.id, "gated_one")).ok).toBe(true);
  });

  it("is a public boolean setting a super admin can change", async () => {
    const row = (
      await db.anon.query(
        "select value from public.app_settings where key = 'require_student_eligibility'",
      )
    ).rows[0];
    expect(row.value).toBe(false);
  });
});

describe("administrator: set or replace a player's Chess.com account", () => {
  it("fixes a typo: archives the old link, links the new one, tells the player, audits it", async () => {
    const u = await db.createUser();
    await link(u.id, "magnus_carlsn"); // typo
    await db.admin.query(
      "update public.chess_account_links set chess_player_id = 111 where user_id = $1",
      [u.id],
    );

    const r = await db
      .as(verifier)
      .query<{ r: LinkResult & { previous: string } }>(
        "select public.admin_set_chess_link($1, 'MagnusCarlsen', 'Typo in the username', 222) as r",
        [u.id],
      );
    expect(r.rows[0]!.r).toMatchObject({
      ok: true,
      chess_username: "magnuscarlsen",
      previous: "magnus_carlsn",
    });

    expect(await linkRow(u.id)).toMatchObject({
      chess_username: "magnuscarlsen",
      chess_player_id: "222",
      verification_method: "admin_review",
    });
    const history = await db.admin.query(
      "select chess_username, unlinked_by, reason from public.chess_link_history where user_id = $1",
      [u.id],
    );
    expect(history.rows).toEqual([
      expect.objectContaining({ chess_username: "magnus_carlsn", unlinked_by: verifier }),
    ]);
    const audit = await db.admin.query(
      "select actor_id, reason, before_data, after_data from public.audit_logs where action = 'chess_link.set_by_admin' and target_id = $1",
      [u.id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({
      actor_id: verifier,
      reason: "Typo in the username",
      before_data: { chess_username: "magnus_carlsn" },
      after_data: { chess_username: "magnuscarlsen", chess_player_id: 222 },
    });
    const note = await db.admin.query(
      "select title from public.notifications where user_id = $1 and title = 'Chess.com account updated'",
      [u.id],
    );
    expect(note.rowCount).toBe(1);
  });

  it("links a player who had no link at all (for example after an unlink)", async () => {
    const u = await db.createUser();
    const r = await db
      .as(verifier)
      .query<{ r: LinkResult & { previous: string | null } }>(
        "select public.admin_set_chess_link($1, 'fresh_link', 'Linked on the player''s behalf') as r",
        [u.id],
      );
    expect(r.rows[0]!.r).toMatchObject({ ok: true, previous: null });
    expect((await linkRow(u.id)).chess_username).toBe("fresh_link");
  });

  it("takes a username back from someone who claimed it first, and tells them", async () => {
    const squatter = await db.createUser();
    const rightful = await db.createUser();
    await link(squatter.id, "someone_elses_name");

    await db
      .as(verifier)
      .query(
        "select public.admin_set_chess_link($1, 'someone_elses_name', 'Squatted; shown in person')",
        [rightful.id],
      );

    expect((await linkRow(rightful.id)).chess_username).toBe("someone_elses_name");
    expect(await linkRow(squatter.id)).toBeUndefined();
    const history = await db.admin.query(
      "select chess_username, reason from public.chess_link_history where user_id = $1",
      [squatter.id],
    );
    expect(history.rows[0]).toMatchObject({ chess_username: "someone_elses_name" });
    expect(history.rows[0].reason).toMatch(/reassigned by an administrator/);
    const note = await db.admin.query(
      "select title from public.notifications where user_id = $1 and title = 'Chess.com link removed'",
      [squatter.id],
    );
    expect(note.rowCount).toBe(1);
    // The displaced member can link their own account again.
    expect((await link(squatter.id, "squatters_real_name")).ok).toBe(true);
  });

  it("is limited to verification admins and requires a reason", async () => {
    const u = await db.createUser();
    const call = (actor: string, reason: string) =>
      db
        .as(actor)
        .query("select public.admin_set_chess_link($1, 'guarded_name', $2)", [u.id, reason]);
    expect((await sqlError(call(u.id, "I would like this please"))).code).toBe("42501");
    expect((await sqlError(call(moderator, "Moderators cannot link accounts"))).code).toBe("42501");
    expect((await sqlError(call(verifier, "no"))).code).toBe("22023");
    expect(await linkRow(u.id)).toBeUndefined();
  });

  it("rejects bad input and no-op changes", async () => {
    const u = await db.createUser();
    await link(u.id, "same_name");
    const run = (username: string, user = u.id) =>
      db
        .as(verifier)
        .query("select public.admin_set_chess_link($1, $2, 'A fine reason')", [user, username]);
    expect((await sqlError(run("same_name"))).message).toMatch(/unchanged/);
    expect((await sqlError(run("!!"))).code).toBe("22023");
    expect((await sqlError(run("valid_name", "00000000-0000-4000-8000-000000000000"))).code).toBe(
      "P0002",
    );
    expect((await linkRow(u.id)).chess_username).toBe("same_name");
  });

  it("hides the player until they have a link again if the admin only unlinks", async () => {
    const p = await db.onboard({ username: "listed_player" });
    expect((await profile(p.id)).is_approved).toBe(true);
    await db
      .as(verifier)
      .query("select public.admin_unlink_chess_account($1, 'Wrong account, will relink')", [p.id]);
    expect((await profile(p.id)).is_approved).toBe(false);
    await db
      .as(verifier)
      .query(
        "select public.admin_set_chess_link($1, 'listed_player_main', 'Relinked to the right account')",
        [p.id],
      );
    expect((await profile(p.id)).is_approved).toBe(true);
  });
});
