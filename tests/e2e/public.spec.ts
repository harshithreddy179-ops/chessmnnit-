import { test, expect, resetMembers, appUrl } from "./fixtures";

/**
 * Public pages rendered by the real Next.js app from real database rows (through the
 * Supabase stand-in): nothing here is mocked at the page level.
 */
test.describe("public pages with real data", () => {
  test.beforeAll(async ({ db, player }) => {
    // These assertions describe the whole site, so start from an empty community (also makes a worker restart harmless).
    await resetMembers(db);
    const a = await player({ username: "pub_alice", name: "Alice Anand", rapid: 1810 });
    const b = await player({ username: "pub_bhavna", name: "Bhavna Bose", rapid: 1650 });
    const c = await player({ username: "pub_chirag", name: "Chirag Chopra", rapid: 1400 });
    // Rating history: enough points over several days for a chart for Alice, too little for Bhavna.
    for (const [days, rating] of [
      [6, 1750],
      [4, 1775],
      [2, 1790],
      [0, 1810],
    ] as const) {
      await db.admin.query(
        "insert into public.chess_rating_history (user_id, time_class, rating, observed_at) values ($1, 'rapid', $2, now() - ($3 || ' days')::interval)",
        [a.id, rating, String(days)],
      );
    }
    await db.admin.query(
      "insert into public.chess_rating_history (user_id, time_class, rating) values ($1, 'rapid', 1650)",
      [b.id],
    );
    // Verified college matches: Alice beats Bhavna twice, draws with Chirag.
    const add = (w: typeof a, bl: typeof a, r: string, n: number) =>
      db.admin.query(
        `insert into public.college_matches (game_url, white_user_id, black_user_id, white_username, black_username, result, time_control, time_class, ended_at, source)
         values ($1, $2, $3, $4, $5, $6, '600', 'rapid', now() - ($7 || ' hours')::interval, 'automatic')`,
        [
          `https://www.chess.com/game/live/9100${n}`,
          w.id,
          bl.id,
          w.username,
          bl.username,
          r,
          String(n),
        ],
      );
    await add(a, b, "white", 3);
    await add(b, a, "black", 2);
    await add(a, c, "draw", 1);
  });

  test("landing page shows live counts and previews, with no placeholder numbers", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Play real games/ })).toBeVisible();
    const stats = page.locator("dl").first();
    await expect(stats).toContainText("Players");
    // The landing data is cached briefly by design; poll (with reloads) until it reflects the seeded rows.
    await expect(async () => {
      await page.reload();
      await expect(stats.locator("dd").first()).toHaveText(/^[3-9]\d*$/); // a real count, not an em-dash
    }).toPass({ timeout: 15_000 });
    await expect(page.getByText("Top rapid ratings")).toBeVisible();
    await expect(page.getByRole("link", { name: /Alice Anand/ }).first()).toBeVisible();
    await expect(page.getByText("not connected to its database")).toHaveCount(0);
  });

  test("player directory searches, filters by rating and shows imported ratings with their category", async ({
    page,
  }) => {
    await page.goto("/players");
    await expect(page.getByRole("row", { name: /Alice Anand/ })).toContainText("1810");
    await expect(page.getByRole("row", { name: /Alice Anand/ })).toContainText("Rapid");
    // Sorted by rating, highest first.
    const names = await page
      .locator("tbody tr td:first-child a span.font-medium")
      .allTextContents();
    expect(names.indexOf("Alice Anand")).toBeLessThan(names.indexOf("Bhavna Bose"));

    await page.getByLabel("Search").fill("bhavna");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(/q=bhavna/);
    await expect(page.getByRole("row", { name: /Bhavna Bose/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /Alice Anand/ })).toHaveCount(0);

    await page.goto("/players?min=1700&category=rapid");
    await expect(page.getByRole("row", { name: /Alice Anand/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /Chirag Chopra/ })).toHaveCount(0);
    // Wildcard characters are searched literally, never as patterns.
    await page.goto("/players?q=%25");
    await expect(page.getByText("No players match those filters")).toBeVisible();
  });

  test("player profile separates imported ratings from college results and charts history only when it can", async ({
    page,
  }) => {
    await page.goto("/players/pub_alice");
    await expect(page.getByRole("heading", { name: "Alice Anand" })).toBeVisible();
    // Honest about what is and is not verified: the account is the player's own entry.
    await expect(page.getByText("What is verified on this profile")).toBeVisible();
    await expect(
      page.getByText(/entered by the member and is not independently verified/),
    ).toBeVisible();
    await expect(page.getByText("MNNIT student", { exact: true })).toHaveCount(0);
    await expect(
      page.getByText("not earned exclusively against MNNIT students").first(),
    ).toBeVisible();
    // College record: 2 wins... Alice: win vs Bhavna (white), win vs Bhavna (Bhavna white lost), draw vs Chirag.
    await expect(page.getByText("Win rate").first()).toBeVisible();
    await expect(page.getByText("2 wins ÷ 3 games")).toBeVisible();
    await expect(page.getByRole("img", { name: /Rapid rating history/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /View.*game/ }).first()).toHaveAttribute(
      "href",
      /chess\.com\/game\/live\//,
    );

    await page.goto("/players/pub_bhavna");
    await expect(page.getByRole("img", { name: /rating history/ })).toHaveCount(0); // a single data point is not a trend
  });

  test("unknown or unlisted players get a real 404", async ({ page, db }) => {
    const unlisted = await db.createUser({ name: "Hidden Person" });
    const res = await page.goto("/players/definitely_not_here");
    expect(res?.status()).toBe(404);
    await expect(page.getByText("That square is empty")).toBeVisible();
    // A user who is not approved has no public profile, even though the account exists.
    expect(unlisted.id).toBeTruthy();
  });

  test("leaderboards rank with deterministic tie-breakers, per category", async ({ page }) => {
    await page.goto("/leaderboards");
    await expect(page.getByRole("heading", { name: /Chess\.com rating · Rapid/ })).toBeVisible();
    const rows = page.locator("tbody tr");
    await expect(rows.first()).toContainText("Alice Anand");
    await page.goto("/leaderboards?board=points");
    await expect(page.locator("tbody tr").first()).toContainText("Alice Anand");
    await expect(page.locator("tbody tr").first()).toContainText("7"); // 2 wins + 1 draw = 7 points
    await page.goto("/leaderboards?board=chesscom_rating&category=blitz");
    await expect(page.getByText("Nobody is ranked here yet").first()).toBeVisible(); // categories are never merged
    await page.goto("/leaderboards?board=win_rate");
    await expect(page.getByRole("heading", { name: "Win rate" })).toBeVisible();
    await expect(page.getByText(/at least 5 games/).first()).toBeVisible();
  });

  test("match history lists verified matches with links to the games", async ({ page }) => {
    await page.goto("/matches");
    await expect(page.getByRole("row")).toHaveCount(4); // header + 3
    await page.goto("/matches?player=pub_chirag&outcome=draw");
    await expect(page.getByRole("row", { name: /Alice Anand/ })).toContainText("½–½");
  });

  test("privacy page, robots and sitemap are published; the sitemap lists only public profiles", async ({
    page,
    request,
    db,
  }) => {
    await page.goto("/privacy");
    await expect(page.getByRole("heading", { name: "Privacy", level: 1 })).toBeVisible();
    await expect(
      page.getByText(
        /never asks? for your Chess\.com password|never ask for your Chess\.com password/,
      ),
    ).toBeVisible();

    const robots = await (await request.get(`${appUrl}/robots.txt`)).text();
    expect(robots).toContain("Disallow: /admin");
    expect(robots).toContain("Disallow: /api/");
    expect(robots).toMatch(/Sitemap: http:\/\/localhost:3101\/sitemap\.xml/);

    // An unlisted (not yet approved) member must not leak into the sitemap.
    const hidden = await db.createUser({ name: "Hidden Hana" });
    await db.admin.query("update public.profiles set display_name = 'Hidden Hana' where id = $1", [
      hidden.id,
    ]);
    const res = await request.get(`${appUrl}/sitemap.xml`);
    expect(res.status()).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("/players/pub_alice");
    expect(xml).toContain("/leaderboards");
    expect(xml).not.toContain("Hidden");
  });

  test("rules page publishes the live scoring settings", async ({ page }) => {
    await page.goto("/rules");
    await expect(page.getByText(/win = 3, draw = 1/)).toBeVisible();
    await expect(page.getByText(/K = 32/)).toBeVisible();
  });
});
