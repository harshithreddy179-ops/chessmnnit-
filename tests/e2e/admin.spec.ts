import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { appUrl, E2E } from "./env";

/** A same-origin POST to the admin API from inside the page, exactly as the dashboard's own forms send it. */
const adminApi = (page: Page, body: Record<string, unknown>) =>
  page.evaluate(async (payload) => {
    const res = await fetch("/api/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, body);

test.describe("administration: who may do what", () => {
  test("the dashboard is closed to ordinary members, and each role sees and may do only its own work", async ({
    db,
    player,
    pageAs,
  }) => {
    const member = await player({ username: "plain_member_e2e", name: "Plain Member" });
    const analyst = await db.createUser({ name: "Ann Analyst" });
    const moderator = await db.createUser({ name: "Mo Moderator" });
    const verifier = await db.createUser({ name: "Vi Verifier" });
    const boss = await db.createUser({ name: "Sue Super" });
    await db.makeAdmin(analyst.id, "analyst");
    await db.makeAdmin(moderator.id, "match_moderator");
    await db.makeAdmin(verifier.id, "verification_admin");
    await db.makeAdmin(boss.id, "super_admin");

    // An ordinary member is sent away, and the API says no regardless of what the UI shows.
    const memberPage = await pageAs(member);
    await memberPage.goto("/admin");
    await expect(memberPage).toHaveURL(/\/dashboard/); // an ordinary member lands on their own dashboard
    const crafted = await adminApi(memberPage, {
      action: "set_role",
      user_id: member.id,
      role: "super_admin",
      grant: true,
      reason: "give me the keys",
    });
    expect(crafted.status).toBe(403);
    expect(
      (
        await db.admin.query(
          "select count(*)::int as n from public.admin_roles where user_id = $1",
          [member.id],
        )
      ).rows[0].n,
    ).toBe(0);

    // The read-only analyst can look but not touch: the UI hides what they cannot use and the database refuses crafted requests.
    const analystPage = await pageAs(analyst);
    await analystPage.goto("/admin");
    await expect(analystPage.getByRole("heading", { name: "Administration" })).toBeVisible();
    await expect(analystPage.getByText("Read-only analyst").first()).toBeVisible();
    const nav = analystPage.getByRole("navigation", { name: "Admin sections" });
    for (const visible of ["Overview", "Users", "Sync & jobs", "Audit log"])
      await expect(nav.getByRole("link", { name: visible })).toBeVisible();
    for (const hidden of ["Verifications", "Eligibility list", "Matches", "Admins", "Settings"])
      await expect(nav.getByRole("link", { name: hidden })).toHaveCount(0);
    for (const path of ["/admin/users", "/admin/sync", "/admin/audit"]) {
      const res = await analystPage.goto(path);
      expect(res?.status()).toBe(200);
      await expect(analystPage).toHaveURL(new RegExp(`${path}$`));
    }
    await analystPage.goto("/admin/verifications");
    await expect(analystPage).not.toHaveURL(/\/admin/); // bounced out (to onboarding, since this analyst never linked a Chess.com account)
    for (const attempt of [
      {
        action: "set_account_status",
        user_id: member.id,
        suspend: true,
        reason: "analysts cannot do this",
      },
      {
        action: "void_challenge",
        challenge_id: "00000000-0000-4000-8000-000000000000",
        reason: "analysts cannot do this either",
      },
      { action: "add_eligibility", kind: "email", values: ["sneaky@example.test"], note: "no" },
      {
        action: "update_setting",
        key: "match_settle_minutes",
        value: 1,
        reason: "analysts cannot do this",
      },
    ]) {
      const r = await adminApi(analystPage, attempt);
      expect(r.status, JSON.stringify(attempt)).toBe(403);
    }
    expect(
      (
        await db.admin.query("select account_status from public.profiles where id = $1", [
          member.id,
        ])
      ).rows[0].account_status,
    ).toBe("active");

    // Moderators cannot manage eligibility; verification admins cannot rule on matches or grant roles.
    const modPage = await pageAs(moderator);
    await modPage.goto("/admin");
    expect(
      (
        await adminApi(modPage, {
          action: "add_eligibility",
          kind: "email",
          values: ["nope@example.test"],
          note: "no",
        })
      ).status,
    ).toBe(403);
    const verPage = await pageAs(verifier);
    await verPage.goto("/admin");
    expect(
      (
        await adminApi(verPage, {
          action: "void_challenge",
          challenge_id: "00000000-0000-4000-8000-000000000000",
          reason: "not a moderator",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await adminApi(verPage, {
          action: "set_role",
          user_id: member.id,
          role: "analyst",
          grant: true,
          reason: "not a super admin",
        })
      ).status,
    ).toBe(403);

    // The super admin sees everything, including the pages only they can use.
    const bossPage = await pageAs(boss);
    await bossPage.goto("/admin");
    const bossNav = bossPage.getByRole("navigation", { name: "Admin sections" });
    for (const label of [
      "Overview",
      "Users",
      "Verifications",
      "Eligibility list",
      "Matches",
      "Sync & jobs",
      "Audit log",
      "Admins",
      "Settings",
    ]) {
      await expect(bossNav.getByRole("link", { name: label })).toBeVisible();
    }
    // Nobody can strip the last super admin (or change their own roles).
    const self = await adminApi(bossPage, {
      action: "set_role",
      user_id: boss.id,
      role: "super_admin",
      grant: false,
      reason: "locking everyone out",
    });
    expect(self.status).toBeGreaterThanOrEqual(400);
    expect(
      (
        await db.admin.query(
          "select count(*)::int as n from public.admin_roles where user_id = $1 and role = 'super_admin'",
          [boss.id],
        )
      ).rows[0].n,
    ).toBe(1);
  });

  test("a super admin grants and revokes a role from the dashboard, and both are audited", async ({
    db,
    pageAs,
  }) => {
    const boss = await db.createUser({ name: "Root Admin" });
    await db.makeAdmin(boss.id, "super_admin");
    const newbie = await db.createUser({ name: "Nina Newadmin" });
    const page = await pageAs(boss);

    await page.goto("/admin/roles");
    await page.getByLabel(/User ID/).fill(newbie.id);
    await page.getByLabel("Role").selectOption("analyst");
    await page.getByLabel(/^Reason/).fill("Needs read-only access to prepare the term report");
    await page.getByRole("button", { name: "Grant role" }).click();
    await expect
      .poll(async () =>
        (
          await db.admin.query("select role from public.admin_roles where user_id = $1", [
            newbie.id,
          ])
        ).rows.map((r) => r.role),
      )
      .toEqual(["analyst"]);

    const newbiePage = await pageAs(newbie);
    await newbiePage.goto("/admin");
    await expect(newbiePage.getByRole("heading", { name: "Administration" })).toBeVisible();

    await page.goto("/admin/roles");
    const row = page.getByRole("row").filter({ hasText: "Nina Newadmin" });
    await row.getByRole("button", { name: "Revoke" }).click();
    await page
      .getByRole("dialog")
      .getByLabel(/^Reason/)
      .fill("Term report finished");
    await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
    await expect
      .poll(
        async () =>
          (
            await db.admin.query(
              "select count(*)::int as n from public.admin_roles where user_id = $1",
              [newbie.id],
            )
          ).rows[0].n,
      )
      .toBe(0);
    await newbiePage.goto("/admin");
    await expect(newbiePage).not.toHaveURL(/\/admin/);

    const audit = (
      await db.admin.query(
        "select action, reason, actor_id from public.audit_logs where action in ('role.granted','role.revoked') and target_id = $1 order by id",
        [newbie.id],
      )
    ).rows;
    expect(audit).toEqual([
      {
        action: "role.granted",
        reason: "Needs read-only access to prepare the term report",
        actor_id: boss.id,
      },
      { action: "role.revoked", reason: "Term report finished", actor_id: boss.id },
    ]);
    await page.goto("/admin/audit?action=role.");
    await expect(page.getByText("Term report finished")).toBeVisible();
  });
});

test.describe("administration: eligibility and account control", () => {
  test("adding an email to the list makes that student eligible; suspending hides a player until reinstated", async ({
    db,
    player,
    pageAs,
    request,
  }) => {
    const verifier = await db.createUser({ name: "Vera Verifier" });
    await db.makeAdmin(verifier.id, "verification_admin");
    const student = await db.createUser({ name: "Stu Dent" });
    const adminPage = await pageAs(verifier);

    // Add the student's Google email through the form.
    await adminPage.goto("/admin/eligibility");
    await adminPage.getByLabel(/^Emails/).fill(` ${student.email.toUpperCase()}\nnot-an-email `);
    await adminPage.getByRole("button", { name: "Add to allowlist" }).click();
    // One bad line rejects the whole batch and names the line; nothing is half-added.
    await expect(
      adminPage.getByText(/“not-an-email” is not a valid email address\. Nothing was added\./),
    ).toBeVisible();
    expect(
      (
        await db.admin.query(
          "select count(*)::int as n from public.student_eligibility where value = $1",
          [student.email.toLowerCase()],
        )
      ).rows[0].n,
    ).toBe(0);
    await adminPage.getByLabel(/^Emails/).fill(` ${student.email.toUpperCase()} `);
    await adminPage.getByRole("button", { name: "Add to allowlist" }).click();
    await expect
      .poll(
        async () =>
          (
            await db.admin.query(
              "select count(*)::int as n from public.student_eligibility where value = $1 and kind = 'email'",
              [student.email.toLowerCase()],
            )
          ).rows[0].n,
      )
      .toBe(1);

    // The student is now recognised the next time they open onboarding.
    const studentPage = await pageAs(student);
    await studentPage.goto("/onboarding");
    await expect(
      studentPage.getByText("You’re on the approved student list").first(),
    ).toBeVisible();
    expect(
      (
        await db.admin.query("select eligibility_status from public.profiles where id = $1", [
          student.id,
        ])
      ).rows[0].eligibility_status,
    ).toBe("verified");

    // Suspend a public player.
    const victim = await player({ username: "suspend_me_e2e", name: "Sam Suspendable" });
    const anon = await request.get(`${appUrl}/players/suspend_me_e2e`);
    expect(anon.status()).toBe(200);
    await adminPage.goto(`/admin/users/${victim.id}`);
    await adminPage.getByRole("button", { name: "Suspend" }).click();
    const dialog = adminPage.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Confirm" })).toBeDisabled(); // a reason is mandatory
    await dialog.getByLabel(/^Reason/).fill("Reported for harassing other members");
    await dialog.getByRole("button", { name: "Confirm" }).click();
    await expect(adminPage.getByText("Suspended", { exact: true })).toBeVisible();
    expect((await request.get(`${appUrl}/players/suspend_me_e2e`)).status()).toBe(404);
    // Sign-in is blocked at the Auth layer too.
    expect(
      (await db.admin.query("select banned_until from auth.users where id = $1", [victim.id]))
        .rows[0].banned_until,
    ).not.toBeNull();
    // The player is told what happened and why.
    expect(
      (
        await db
          .as(victim.id)
          .query(
            "select body from public.notifications where type = 'account_notice' order by created_at desc",
          )
      ).rows[0].body,
    ).toContain("Reported for harassing other members");

    await adminPage.getByRole("button", { name: "Reinstate" }).click();
    await adminPage
      .getByRole("dialog")
      .getByLabel(/^Reason/)
      .fill("Apologised, first offence");
    await adminPage.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
    await expect(adminPage.getByText("Public", { exact: true })).toBeVisible();
    expect((await request.get(`${appUrl}/players/suspend_me_e2e`)).status()).toBe(200);

    const audit = (
      await db.admin.query(
        "select action, reason from public.audit_logs where target_id = $1 and action in ('user.suspended','user.reinstated') order by id",
        [victim.id],
      )
    ).rows;
    expect(audit).toEqual([
      { action: "user.suspended", reason: "Reported for harassing other members" },
      { action: "user.reinstated", reason: "Apologised, first offence" },
    ]);
  });
});

test.describe("administration: match moderation", () => {
  test("an ambiguous result goes to a moderator, who picks the real game; the player then disputes it and the ruling releases it", async ({
    db,
    chess,
    player,
    pageAs,
    request,
  }) => {
    const ana = await player({ username: "ana_mod_e2e", name: "Ana Ambiguous" });
    const ben = await player({ username: "ben_mod_e2e", name: "Ben Both" });
    const moderator = await db.createUser({ name: "Mona Moderator" });
    await db.makeAdmin(moderator.id, "match_moderator");
    chess.clearGames();

    // An accepted challenge, three hours ago, and TWO games between them since: the system must not guess.
    const id = (
      await db
        .as(ana.id)
        .query(
          "insert into public.challenges (recipient_id, time_control) values ($1, '600') returning id",
          [ben.id],
        )
    ).rows[0].id as string;
    await db
      .as(ben.id)
      .query("update public.challenges set status = 'accepted' where id = $1", [id]);
    await db.admin.query(
      "update public.challenges set accepted_at = now() - interval '3 hours', next_check_at = now() - interval '1 second' where id = $1",
      [id],
    );
    const first = chess.addGame({
      white: "ana_mod_e2e",
      black: "ben_mod_e2e",
      winner: "white",
      endedAt: new Date(Date.now() - 80 * 60_000),
    });
    const second = chess.addGame({
      white: "ben_mod_e2e",
      black: "ana_mod_e2e",
      winner: "white",
      endedAt: new Date(Date.now() - 30 * 60_000),
    });
    const run = await request.post(`${appUrl}/api/cron/sync-challenges`, {
      headers: { authorization: `Bearer ${E2E.cronSecret}` },
    });
    expect((await run.json()).stats).toMatchObject({ claimed: 1, verified: 0 });
    const c = (
      await db.admin.query("select status, review_reason from public.challenges where id = $1", [
        id,
      ])
    ).rows[0];
    expect(c.status).toBe("needs_review");
    expect(c.review_reason).toMatch(/2 completed games between these players/);
    expect(
      (
        await db.admin.query(
          "select count(*)::int as n from public.college_matches where challenge_id = $1",
          [id],
        )
      ).rows[0].n,
    ).toBe(0);

    // Both players are told, and the challenge page says plainly that a human decides.
    const anaPage = await pageAs(ana);
    await anaPage.goto(`/challenges/${id}`);
    await expect(anaPage.getByText("A moderator will decide", { exact: true })).toBeVisible();
    expect(
      (
        await db
          .as(ben.id)
          .query(
            "select count(*)::int as n from public.notifications where type = 'match_needs_review'",
          )
      ).rows[0].n,
    ).toBe(1);

    // The moderator sees both candidate games with their links and picks the right one.
    const modPage = await pageAs(moderator);
    await modPage.goto("/admin/matches");
    await expect(modPage.getByText("@ana_mod_e2e").first()).toBeVisible();
    for (const g of [first, second])
      await expect(
        modPage.getByRole("link", {
          name: new RegExp(g.url.replace("https://www.chess.com/", "").replace(/[/.]/g, "\\$&")),
        }),
      ).toBeVisible();
    await modPage.getByRole("button", { name: "Pick the Chess.com game" }).click();
    await modPage.getByLabel(/Chess\.com game URL/).fill(second.url);
    await modPage
      .getByLabel(/Why this game/)
      .fill("Second game matches the 10-minute control agreed in the club chat");
    await modPage.getByRole("button", { name: "Record result" }).click();
    await expect
      .poll(
        async () =>
          (await db.admin.query("select status from public.challenges where id = $1", [id])).rows[0]
            .status,
      )
      .toBe("result_verified");

    const m = (
      await db.admin.query(
        "select game_url, source, status, result, white_username from public.college_matches where challenge_id = $1",
        [id],
      )
    ).rows;
    expect(m).toEqual([
      {
        game_url: second.url,
        source: "admin",
        status: "verified",
        result: "white",
        white_username: "ben_mod_e2e",
      },
    ]);
    const stats = (u: string) =>
      db.admin
        .query(
          "select wins, losses, games_played, points from public.player_stats where user_id = $1",
          [u],
        )
        .then((r) => r.rows[0]);
    expect(await stats(ben.id)).toEqual({ wins: 1, losses: 0, games_played: 1, points: 3 });
    expect(await stats(ana.id)).toEqual({ wins: 0, losses: 1, games_played: 1, points: 0 });
    expect(
      (
        await db.admin.query(
          "select actor_id, reason from public.audit_logs where action = 'match.resolved_with_game' and target_id = $1",
          [id],
        )
      ).rows,
    ).toEqual([
      {
        actor_id: moderator.id,
        reason: "Second game matches the 10-minute control agreed in the club chat",
      },
    ]);

    // Ana disagrees. A disputed result stops counting immediately, before any moderator acts.
    await anaPage.goto(`/challenges/${id}`);
    await expect(anaPage.getByText("Confirmed by a moderator.")).toBeVisible();
    await anaPage.getByRole("button", { name: "Dispute this result" }).click();
    const dialog = anaPage.getByRole("dialog");
    await dialog
      .getByLabel("What happened?")
      .fill("The first game was the agreed one, the second was a casual rematch.");
    await dialog.getByRole("button", { name: "Submit" }).click();
    await expect
      .poll(
        async () =>
          (
            await db.admin.query(
              "select status from public.college_matches where challenge_id = $1",
              [id],
            )
          ).rows[0].status,
      )
      .toBe("disputed");
    // A player with no counted games simply has no statistics row.
    expect((await stats(ben.id))?.games_played ?? 0).toBe(0);
    expect((await stats(ana.id))?.games_played ?? 0).toBe(0);
    await anaPage.reload();
    await expect(anaPage.getByText("A dispute is open")).toBeVisible();

    // The moderator sees the dispute and rules; closing it releases the match back into the statistics.
    await modPage.goto("/admin/matches");
    await expect(modPage.getByText("The first game was the agreed one").first()).toBeVisible(); // streaming can briefly render the Suspense payload twice
    await modPage.getByRole("button", { name: "Mark resolved" }).click();
    await modPage
      .getByRole("dialog")
      .getByLabel(/Ruling/)
      .fill("Checked both games; the 10-minute game is the one that counts");
    await modPage.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
    await expect
      .poll(
        async () =>
          (
            await db.admin.query(
              "select status from public.college_matches where challenge_id = $1",
              [id],
            )
          ).rows[0].status,
      )
      .toBe("verified");
    expect(await stats(ben.id)).toMatchObject({ wins: 1, games_played: 1, points: 3 });
    expect(
      (
        await db
          .as(ana.id)
          .query(
            "select body from public.notifications where type = 'dispute_update' order by created_at desc",
          )
      ).rows[0].body,
    ).toContain("10-minute game");
  });

  test("a moderator can correct a recorded result; statistics follow and the correction is audited with its reason", async ({
    db,
    chess,
    player,
    pageAs,
  }) => {
    const cy = await player({ username: "cy_fix_e2e", name: "Cy Corrected" });
    const di = await player({ username: "di_fix_e2e", name: "Di Disputed" });
    const moderator = await db.createUser({ name: "Mick Moderator" });
    await db.makeAdmin(moderator.id, "match_moderator");
    chess.clearGames();
    const g = chess.addGame({
      white: "cy_fix_e2e",
      black: "di_fix_e2e",
      winner: "white",
      endedAt: new Date(Date.now() - 20 * 60_000),
    });
    // A moderator-entered result is the documented last resort when the archives do not have the game.
    const id = (
      await db
        .as(cy.id)
        .query(
          "insert into public.challenges (recipient_id, time_control) values ($1, '600') returning id",
          [di.id],
        )
    ).rows[0].id as string;
    await db
      .as(di.id)
      .query("update public.challenges set status = 'accepted' where id = $1", [id]);
    const modPage = await pageAs(moderator);
    await modPage.goto("/admin/matches");
    const res = await adminApi(modPage, {
      action: "manual_result",
      challenge_id: id,
      game_url: g.url,
      winner: "challenger",
      white_is_challenger: true,
      reason: "Both players showed the finished game at the club room",
    });
    expect(res.status).toBe(200);
    const stat = (u: string) =>
      db.admin
        .query(
          "select wins, losses, draws, games_played, points from public.player_stats where user_id = $1",
          [u],
        )
        .then((r) => r.rows[0]);
    expect(await stat(cy.id)).toMatchObject({ wins: 1, points: 3 });
    // The match is clearly labelled as moderator-entered, not as verified from Chess.com data.
    expect(
      (
        await db.admin.query("select source from public.college_matches where challenge_id = $1", [
          id,
        ])
      ).rows[0].source,
    ).toBe("admin");

    await modPage.goto("/admin/matches");
    const row = modPage
      .locator("div")
      .filter({ hasText: "@cy_fix_e2e" })
      .filter({ has: modPage.getByRole("button", { name: "Set draw" }) })
      .last();
    await row.getByRole("button", { name: "Set draw" }).click();
    await modPage
      .getByRole("dialog")
      .getByLabel(/^Reason/)
      .fill("Result was a draw by repetition, not a win");
    await modPage.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
    await expect.poll(async () => (await stat(cy.id)).draws).toBe(1);
    expect(await stat(cy.id)).toMatchObject({ wins: 0, draws: 1, points: 1 });
    expect(await stat(di.id)).toMatchObject({ losses: 0, draws: 1, points: 1 });
    const matchId = (
      await db.admin.query("select id from public.college_matches where challenge_id = $1", [id])
    ).rows[0].id as string;
    expect(
      (
        await db.admin.query(
          "select reason, actor_id from public.audit_logs where action = 'match.corrected' and target_id = $1",
          [matchId],
        )
      ).rows,
    ).toEqual([{ reason: "Result was a draw by repetition, not a win", actor_id: moderator.id }]);
  });
});

test.describe("administration: settings and job visibility", () => {
  test("settings changes require a reason and are audited; the job log shows scheduled runs", async ({
    db,
    pageAs,
    request,
  }) => {
    const boss = await db.createUser({ name: "Settings Boss" });
    await db.makeAdmin(boss.id, "super_admin");
    const page = await pageAs(boss);

    await page.goto("/admin/settings");
    const input = page.getByLabel("match_settle_minutes", { exact: true });
    const save = page.locator("form").filter({ has: input }).getByRole("button", { name: "Save" });
    await input.fill("45");
    await expect(save).toBeDisabled(); // no reason yet
    await page
      .getByLabel("Reason for changing match_settle_minutes")
      .fill("Shorten the safety window for the autumn season");
    await save.click();
    await expect
      .poll(
        async () =>
          (
            await db.admin.query(
              "select value from public.app_settings where key = 'match_settle_minutes'",
            )
          ).rows[0].value,
      )
      .toBe(45);
    // Put it back so later runs of the matcher keep their default window.
    await db.admin.query(
      "update public.app_settings set value = '60'::jsonb where key = 'match_settle_minutes'",
    );
    expect(
      (
        await db.admin.query(
          "select actor_id, reason from public.audit_logs where action = 'setting.updated' and target_id = 'match_settle_minutes'",
        )
      ).rows.at(-1),
    ).toEqual({
      actor_id: boss.id,
      reason: "Shorten the safety window for the autumn season",
    });

    // Scheduled jobs are recorded and visible to administrators.
    const run = await request.post(`${appUrl}/api/cron/housekeeping`, {
      headers: { authorization: `Bearer ${E2E.cronSecret}` },
    });
    expect(run.status()).toBe(200);
    await page.goto("/admin/sync");
    await expect(page.getByText("housekeeping").first()).toBeVisible();
    await expect(page.getByText("awaiting Chess.com approval")).toBeVisible(); // OAuth is reported honestly as not available
  });
});
