import { test, expect, appUrl } from "./fixtures";
import { playVerifiedMatch } from "./flows";

test.describe("settings and account", () => {
  test("profile and preferences are validated, saved and shown publicly; closing challenges is enforced by the server", async ({ db, player, pageAs }) => {
    const me = await player({ username: "settings_me_e2e", name: "Mia Settings" });
    const other = await player({ username: "settings_other_e2e", name: "Otto Other" });
    const page = await pageAs(me);

    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    // The verified Chess.com identity is displayed but cannot be edited here.
    await expect(page.getByText("@settings_me_e2e").first()).toBeVisible();
    await expect(page.getByLabel(/Chess\.com username/)).toHaveCount(0);

    // Validation comes from the server, shown next to the field.
    await page.getByLabel(/^Display name/).fill("M");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText(/at least 2 characters/)).toBeVisible();
    expect((await db.admin.query("select display_name from public.profiles where id = $1", [me.id])).rows[0].display_name).toBe("Mia Settings");

    await page.getByLabel(/^Display name/).fill("Mia the Strategist");
    await page.getByLabel(/^About you/).fill("Endgames over openings. Library blitz on Fridays.");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect.poll(async () => (await db.admin.query("select display_name from public.profiles where id = $1", [me.id])).rows[0].display_name).toBe("Mia the Strategist");

    // The public profile shows it.
    await page.goto("/players/settings_me_e2e");
    await expect(page.getByRole("heading", { name: "Mia the Strategist" })).toBeVisible();
    await expect(page.getByText("Library blitz on Fridays.")).toBeVisible();

    // Stopping challenges is enforced on the server, not just hidden in the UI.
    await page.goto("/settings");
    await page.getByLabel("Blitz").check();
    await page.getByRole("switch", { name: /open to challenges/ }).click();
    await page.getByRole("button", { name: "Save preferences" }).click();
    await expect.poll(async () => (await db.admin.query("select open_to_challenges from public.profiles where id = $1", [me.id])).rows[0].open_to_challenges).toBe(false);
    expect((await db.admin.query("select preferred_time_classes from public.profiles where id = $1", [me.id])).rows[0].preferred_time_classes).toContain("blitz");

    // Others no longer see a Challenge button...
    const otherPage = await pageAs(other);
    await otherPage.goto("/players/settings_me_e2e");
    await expect(otherPage.getByText("Not taking challenges")).toBeVisible();
    await expect(otherPage.getByRole("button", { name: "Challenge", exact: true })).toHaveCount(0);
    // ...and a hand-made request is refused by the database rule, not merely hidden in the UI.
    const refused = await otherPage.evaluate(async (recipient) => {
      const res = await fetch("/api/challenges", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ recipient_id: recipient, time_control: "600", message: null }) });
      return { status: res.status, code: (await res.json()).error?.code };
    }, me.id);
    expect(refused).toEqual({ status: 409, code: "recipient_closed" });
    expect((await db.admin.query("select count(*)::int as n from public.challenges where challenger_id = $1 and recipient_id = $2", [other.id, me.id])).rows[0].n).toBe(0);
  });

  test("choosing Invisible is stored as a preference and applied to the live status", async ({ db, player, pageAs }) => {
    const me = await player({ username: "invisible_e2e", name: "Ivy Invisible" });
    const page = await pageAs(me);
    await page.goto("/settings");
    await page.getByLabel("My status").first().selectOption("invisible");
    await expect.poll(async () => (await db.admin.query("select presence_mode from public.profile_settings where user_id = $1", [me.id])).rows[0].presence_mode).toBe("invisible");
    await page.reload();
    await expect(page.getByLabel("My status").first()).toHaveValue("invisible");
    // Online/offline itself is never written to the database (it is live-only).
    const cols = (await db.admin.query("select column_name from information_schema.columns where table_schema = 'public' and table_name in ('profiles','profile_settings') and column_name ~ 'online|last_seen|is_present'")).rows;
    expect(cols).toEqual([]);
  });

  test("deleting an account removes the person but keeps opponents' verified history, which is stated plainly", async ({ db, chess, player, pageAs, request }) => {
    const leaver = await player({ username: "leaver_e2e", name: "Lee Leaver" });
    const stayer = await player({ username: "stayer_e2e", name: "Sid Stayer" });
    chess.clearGames();
    const challengeId = await playVerifiedMatch({ db, chess, request }, stayer, leaver, "white");
    const before = (await db.admin.query("select games_played, wins from public.player_stats where user_id = $1", [stayer.id])).rows[0];
    expect(before).toEqual({ games_played: 1, wins: 1 });

    const page = await pageAs(leaver);
    await page.goto("/settings");
    await page.getByRole("button", { name: "Delete my account" }).click();
    const dialog = page.getByRole("dialog");
    // What stays is spelled out before the person commits.
    await expect(dialog.getByText(/Chess\.com username/)).toBeVisible();
    const confirm = dialog.getByRole("button", { name: "Delete permanently" });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel(/Type DELETE/).fill("delete");
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel(/Type DELETE/).fill("DELETE");
    await confirm.click();
    await expect(page).toHaveURL(/localhost:3101\/?$/);

    // The person is gone: profile, link, ratings, notifications, sign-in.
    expect((await db.admin.query("select count(*)::int as n from auth.users where id = $1", [leaver.id])).rows[0].n).toBe(0);
    for (const table of ["profiles", "chess_account_links", "chess_ratings", "notifications"]) {
      const col = table === "profiles" ? "id" : "user_id";
      expect((await db.admin.query(`select count(*)::int as n from public.${table} where ${col} = $1`, [leaver.id])).rows[0].n, table).toBe(0);
    }
    expect((await request.get(`${appUrl}/players/leaver_e2e`)).status()).toBe(404);
    expect((await db.admin.query("select count(*)::int as n from public.audit_logs where action = 'account.deleted' and target_id = $1", [leaver.id])).rows[0].n).toBe(1);

    // The opponent's history survives and still counts, but no longer points at a member.
    // (The challenge row itself cascaded away with the account, so the match is found by its players.)
    const m = (await db.admin.query("select challenge_id, white_user_id, black_user_id, black_username, status from public.college_matches where white_username = 'stayer_e2e' and black_username = 'leaver_e2e'")).rows;
    expect(m).toEqual([{ challenge_id: null, white_user_id: stayer.id, black_user_id: null, black_username: "leaver_e2e", status: "verified" }]);
    void challengeId;
    expect((await db.admin.query("select games_played, wins from public.player_stats where user_id = $1", [stayer.id])).rows[0]).toEqual(before);
    const stayerPage = await pageAs(stayer);
    await stayerPage.goto("/matches");
    await expect(stayerPage.getByText("stayer_e2e").first()).toBeVisible();
  });

  test("the last super admin cannot delete their own account", async ({ db, pageAs }) => {
    const boss = await db.createUser({ name: "Only Boss" });
    // Replace any super admin left by earlier specs so this one really is the last.
    await db.admin.query("delete from public.admin_roles where role = 'super_admin'");
    await db.makeAdmin(boss.id, "super_admin");
    const page = await pageAs(boss);
    await page.goto("/dashboard");
    const res = await page.evaluate(async () => {
      const r = await fetch("/api/account/delete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: "DELETE" }) });
      return { status: r.status, body: await r.json() };
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("last_super_admin");
    expect((await db.admin.query("select count(*)::int as n from auth.users where id = $1", [boss.id])).rows[0].n).toBe(1);
  });
});
