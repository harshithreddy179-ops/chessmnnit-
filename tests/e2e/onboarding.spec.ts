import { test, expect } from "./fixtures";

/**
 * The player journey: Google sign-in (simulated by a session cookie) -> type a Chess.com username ->
 * finished registration. Chess.com itself is a local stand-in modelled on the documented API;
 * everything else is the real application.
 */
test.describe("onboarding", () => {
  test("a newcomer types a Chess.com username and is listed, with no student list and no ownership proof", async ({
    db,
    chess,
    pageAs,
  }) => {
    const user = await db.createUser({ name: "Nia Newcomer" });
    const page = await pageAs(user);

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/onboarding/);
    await expect(page.getByRole("heading", { name: "Welcome to the club" })).toBeVisible();

    // Nothing about the student list, and no code to put on a profile.
    await expect(page.getByText("Confirm you’re an MNNIT student")).toHaveCount(0);
    await expect(page.getByText(/approved student list/)).toHaveCount(0);
    const checklist = page.getByRole("list", { name: "Account status" });
    await expect(
      checklist
        .getByRole("listitem")
        .filter({ hasText: "Google account signed in" })
        .getByLabel("Complete"),
    ).toBeVisible();
    await expect(
      checklist.getByRole("listitem").filter({ hasText: "College eligibility" }),
    ).toHaveCount(0);
    await expect(
      checklist
        .getByRole("listitem")
        .filter({ hasText: "Chess.com account linked" })
        .getByLabel("Not done"),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Complete registration" })).toBeDisabled();

    chess.setProfile({ username: "nia_chess", player_id: 31337, location: "Prayagraj" });
    chess.setStats("nia_chess", {
      chess_rapid: {
        last: { rating: 1337, date: 1_760_000_000 },
        best: { rating: 1400 },
        record: { win: 5, loss: 4, draw: 1 },
      },
    });
    await page
      .getByRole("textbox", { name: /Chess\.com username/ })
      .fill("https://www.chess.com/member/Nia_Chess");
    await page.getByRole("button", { name: "Link my account" }).click();
    await expect(page.getByText("Linked to @nia_chess").first()).toBeVisible();

    // Recorded honestly: self-declared, not "verified". The player id and first ratings came from Chess.com.
    const link = (
      await db.admin.query(
        "select chess_username, chess_player_id::int as pid, verification_method from public.chess_account_links where user_id = $1",
        [user.id],
      )
    ).rows[0];
    expect(link).toEqual({
      chess_username: "nia_chess",
      pid: 31337,
      verification_method: "self_declared",
    });
    expect(
      (
        await db.admin.query(
          "select rating from public.chess_ratings where user_id = $1 and time_class = 'rapid'",
          [user.id],
        )
      ).rows[0].rating,
    ).toBe(1337);

    await page.getByRole("button", { name: "Complete registration" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText("1337")).toBeVisible();
    expect(
      (await db.admin.query("select is_approved from public.profiles where id = $1", [user.id]))
        .rows[0].is_approved,
    ).toBe(true);

    // The public profile does not call the account verified.
    await page.goto("/players/nia_chess");
    await expect(page.getByRole("heading", { name: "Nia Newcomer" })).toBeVisible();
    await expect(
      page.getByText(/entered by the member and is not independently verified/),
    ).toBeVisible();
    await expect(page.getByText("MNNIT student", { exact: true })).toHaveCount(0);
  });

  test("rejects malformed usernames and accounts that do not exist on Chess.com", async ({
    db,
    pageAs,
  }) => {
    const u = await db.createUser({ name: "Eli Eager" });
    const page = await pageAs(u);
    await page.goto("/onboarding");
    await page.getByRole("textbox", { name: /Chess\.com username/ }).fill("no spaces allowed!");
    await page.getByRole("button", { name: "Link my account" }).click();
    await expect(page.getByText(/Enter a valid Chess\.com username/)).toBeVisible();
    await page.getByRole("textbox", { name: /Chess\.com username/ }).fill("ghost_account_xyz");
    await page.getByRole("button", { name: "Link my account" }).click();
    await expect(
      page.getByText(/No Chess\.com account named "ghost_account_xyz" was found/),
    ).toBeVisible();
    expect(
      (
        await db.admin.query(
          "select count(*)::int as n from public.chess_account_links where user_id = $1",
          [u.id],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  test("still links, and says it could not check, when Chess.com is unreachable", async ({
    db,
    chess,
    pageAs,
  }) => {
    const u = await db.createUser({ name: "Una Unlucky" });
    const page = await pageAs(u);
    await page.goto("/onboarding");
    chess.fail(/\/player\/outage_user$/, 500, 5);
    try {
      await page.getByRole("textbox", { name: /Chess\.com username/ }).fill("outage_user");
      await page.getByRole("button", { name: "Link my account" }).click();
      await expect(
        page.getByText(/Chess\.com could not be reached to confirm the name/),
      ).toBeVisible();
    } finally {
      chess.clearFailures();
    }
    expect(
      (
        await db.admin.query(
          "select chess_username from public.chess_account_links where user_id = $1",
          [u.id],
        )
      ).rows[0].chess_username,
    ).toBe("outage_user");
  });

  test("a Chess.com username already linked to someone else cannot be taken", async ({
    db,
    chess,
    player,
    pageAs,
  }) => {
    const owner = await player({ username: "taken_name" });
    chess.setProfile({ username: "taken_name", player_id: owner.playerId, location: "Allahabad" });
    const rival = await db.createUser({ name: "Rick Rival" });
    const page = await pageAs(rival);
    await page.goto("/onboarding");
    await page.getByRole("textbox", { name: /Chess\.com username/ }).fill("Taken_Name");
    await page.getByRole("button", { name: "Link my account" }).click();
    await expect(page.getByText(/already linked to another member/)).toBeVisible();
    expect(
      (
        await db.admin.query(
          "select user_id from public.chess_account_links where chess_username = 'taken_name'",
        )
      ).rows.map((r) => r.user_id),
    ).toEqual([owner.id]);
  });

  test("when an administrator turns the student list on, new accounts must match it first", async ({
    db,
    chess,
    pageAs,
  }) => {
    await db.requireEligibility(true);
    try {
      const user = await db.createUser({ name: "Gail Gated" });
      const page = await pageAs(user);
      await page.goto("/dashboard");
      await expect(page).toHaveURL(/\/onboarding/);
      await expect(page.getByText("Confirm you’re an MNNIT student")).toBeVisible();
      await expect(
        page
          .getByRole("list", { name: "Account status" })
          .getByRole("listitem")
          .filter({ hasText: "College eligibility verified" })
          .getByLabel("Not done"),
      ).toBeVisible();
      // The Chess.com step is locked until eligible.
      await expect(page.getByText("Confirm you’re a student first")).toBeVisible();

      await page.getByLabel(/Roll number or college email/).fill("2024CA17");
      await page.getByRole("button", { name: "Request review" }).click();
      await expect(page.getByText("Waiting for an administrator")).toBeVisible();

      const admin = await db.createUser({ name: "Vera Admin" });
      await db.makeAdmin(admin.id, "verification_admin");
      const req = (
        await db.admin.query("select id from public.eligibility_requests where user_id = $1", [
          user.id,
        ])
      ).rows[0];
      await db
        .as(admin.id)
        .query(
          "select * from public.admin_review_eligibility_request($1, true, 'Roll number matches the department list')",
          [req.id],
        );

      await page.reload();
      await expect(page.getByText("You’re on the approved student list")).toBeVisible();
      chess.setProfile({ username: "gail_gated", player_id: 5150, location: "Allahabad" });
      await page.getByRole("textbox", { name: /Chess\.com username/ }).fill("gail_gated");
      await page.getByRole("button", { name: "Link my account" }).click();
      await expect(page.getByText("Linked to @gail_gated").first()).toBeVisible();
    } finally {
      await db.requireEligibility(false);
    }
  });
});

test.describe("an administrator fixes a wrong Chess.com link", () => {
  test("replaces a typo'd username; the player is told and the change is audited", async ({
    db,
    chess,
    player,
    pageAs,
  }) => {
    const p = await player({ username: "typo_nme", name: "Tina Typo" });
    chess.setProfile({ username: "typo_name", player_id: 777, location: "Allahabad" });
    const admin = await db.createUser({ name: "Vera Verifier" });
    await db.makeAdmin(admin.id, "verification_admin");

    const page = await pageAs(admin);
    await page.goto(`/admin/users/${p.id}`);
    await page.getByRole("button", { name: "Change Chess.com account" }).click();
    await page.getByLabel("Chess.com username").fill("Typo_Name");
    await page.getByLabel("Reason").fill("Typo in the username");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("@typo_name").first()).toBeVisible();

    const link = (
      await db.admin.query(
        "select chess_username, chess_player_id::int as pid, verification_method from public.chess_account_links where user_id = $1",
        [p.id],
      )
    ).rows[0];
    expect(link).toEqual({
      chess_username: "typo_name",
      pid: 777,
      verification_method: "admin_review",
    });
    expect(
      (
        await db.admin.query(
          "select actor_id, actor_kind, reason from public.audit_logs where action = 'chess_link.set_by_admin' and target_id = $1",
          [p.id],
        )
      ).rows,
    ).toEqual([{ actor_id: admin.id, actor_kind: "admin", reason: "Typo in the username" }]);
    expect(
      (
        await db
          .as(p.id)
          .query("select title from public.notifications where title = 'Chess.com account updated'")
      ).rowCount,
    ).toBe(1);
  });

  test("gives a username back to the member it belongs to, unlinking whoever claimed it first", async ({
    db,
    chess,
    player,
    pageAs,
  }) => {
    const squatter = await db.createUser({ name: "Sid Squatter" });
    await db.as(squatter.id).query("select public.link_my_chess_account('rightful_name')");
    const rightful = await player({ username: "wrong_one", name: "Rhea Rightful" });
    chess.setProfile({ username: "rightful_name", player_id: 888, location: "Allahabad" });
    const admin = await db.createUser({ name: "Vera Verifier" });
    await db.makeAdmin(admin.id, "verification_admin");

    const page = await pageAs(admin);
    await page.goto(`/admin/users/${rightful.id}`);
    await page.getByRole("button", { name: "Change Chess.com account" }).click();
    await page.getByLabel("Chess.com username").fill("rightful_name");
    await page.getByLabel("Reason").fill("Shown the account in person at the club");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("@rightful_name").first()).toBeVisible();

    expect(
      (
        await db.admin.query(
          "select user_id from public.chess_account_links where chess_username = 'rightful_name'",
        )
      ).rows.map((r) => r.user_id),
    ).toEqual([rightful.id]);
    expect(
      (
        await db.admin.query("select 1 from public.chess_account_links where user_id = $1", [
          squatter.id,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await db
          .as(squatter.id)
          .query("select title from public.notifications where title = 'Chess.com link removed'")
      ).rowCount,
    ).toBe(1);
  });
});
