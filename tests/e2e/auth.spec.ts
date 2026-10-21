import { test, expect, appUrl } from "./fixtures";

test.describe("authentication and route protection", () => {
  test("member-only pages send visitors to sign in and remember where they were going", async ({
    page,
  }) => {
    for (const path of [
      "/dashboard",
      "/challenges",
      "/notifications",
      "/settings",
      "/admin",
      "/onboarding",
    ]) {
      await page.goto(path);
      await expect(page).toHaveURL(
        new RegExp(`/login\\?next=${encodeURIComponent(path).replace(/%/g, "%")}`),
      );
    }
    await expect(page.getByRole("button", { name: /Continue with Google/ })).toBeEnabled();
  });

  test("the API refuses unauthenticated and cross-site requests", async ({ request }) => {
    const anon = await request.post("/api/challenges", {
      data: { recipient_id: "00000000-0000-4000-8000-000000000000", time_control: "600" },
    });
    expect(anon.status()).toBe(401);
    const forged = await request.patch("/api/profile", {
      data: { display_name: "x" },
      headers: { origin: "https://evil.example" },
    });
    expect(forged.status()).toBe(403);
    expect((await forged.json()).error.code).toBe("cross_site");
    expect(
      (
        await request.post("/api/admin", {
          data: { action: "retry_player_sync", user_id: "00000000-0000-4000-8000-000000000000" },
        })
      ).status(),
    ).toBe(401);
  });

  test("a forged or garbage session cookie is treated as signed out", async ({ context, page }) => {
    await context.addCookies([
      {
        name: "sb-localhost-auth-token",
        value:
          "base64-" +
          Buffer.from(
            JSON.stringify({
              access_token: "a.b.c",
              refresh_token: "x",
              expires_at: 9999999999,
              user: { id: "x" },
            }),
          ).toString("base64url"),
        url: appUrl,
      },
    ]);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("a signed-in member skips the login page and can sign out", async ({ db, pageAs }) => {
    const u = await db.createUser({ name: "Signed In" });
    const page = await pageAs(u);
    await page.goto("/login");
    await expect(page).toHaveURL(/\/onboarding|\/dashboard/); // brand-new accounts are sent to onboarding
    await page.goto("/rules");
    await page.getByRole("button", { name: "Account menu" }).click();
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith("/auth/signout") && r.request().method() === "POST",
      ),
      page.getByRole("menuitem", { name: "Sign out" }).click(),
    ]);
    await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible(); // header is back to the signed-out state
    expect((await page.context().cookies()).filter((c) => c.name.startsWith("sb-"))).toHaveLength(
      0,
    );
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/login/);
  });

  test("administrator pages are not reachable by ordinary members, and roles cannot be forged", async ({
    db,
    pageAs,
  }) => {
    const u = await db.createUser({ name: "Not An Admin" });
    const page = await pageAs(u);
    await page.goto("/admin");
    await expect(page).not.toHaveURL(/\/admin/);
    // Even a crafted request is rejected by the database, not just by the page.
    const res = await page.request.post("/api/admin", {
      data: {
        action: "update_setting",
        key: "include_demo_data",
        value: true,
        reason: "let me in",
      },
    });
    expect(res.status()).toBe(403);
    const forged = await page.request.post("/api/admin", {
      data: {
        action: "set_role",
        user_id: u.id,
        role: "super_admin",
        grant: true,
        reason: "self promotion",
        roles: ["super_admin"],
      },
    });
    expect(forged.status()).toBe(403);
    const roles = await db.admin.query(
      "select count(*)::int as n from public.admin_roles where user_id = $1",
      [u.id],
    );
    expect(roles.rows[0].n).toBe(0);
  });

  test("scheduled-job endpoints require the shared secret", async ({ request }) => {
    expect((await request.get("/api/cron/run-all")).status()).toBe(401);
    expect(
      (
        await request.get("/api/cron/run-all", { headers: { authorization: "Bearer wrong" } })
      ).status(),
    ).toBe(401);
    expect(
      (
        await request.get("/api/cron/not-a-job", {
          headers: { authorization: "Bearer e2e-cron-secret-0123456789abcdef0123" },
        })
      ).status(),
    ).toBe(404);
    const ok = await request.get("/api/cron/housekeeping", {
      headers: { authorization: "Bearer e2e-cron-secret-0123456789abcdef0123" },
    });
    expect(ok.status()).toBe(200);
    expect((await ok.json()).status).toBe("ok");
  });
});
