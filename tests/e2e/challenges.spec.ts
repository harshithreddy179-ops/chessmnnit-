import type { APIRequestContext, Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { appUrl, E2E } from "./env";

/**
 * The whole matchmaking loop through the real UI and the real scheduled-job endpoint:
 * challenge -> accept -> (the students play on Chess.com) -> automatic detection ->
 * settle window -> verified result -> statistics. Chess.com is the local stand-in.
 */

const cron = (request: APIRequestContext, job: string, secret: string | null = E2E.cronSecret) =>
  request.post(`${appUrl}/api/cron/${job}`, { headers: secret ? { authorization: `Bearer ${secret}` } : {} });

/** A same-origin request from inside the page, exactly as the app's own client would send it. */
const patchChallenge = (page: Page, id: string, action: string) =>
  page.evaluate(
    async ([challengeId, act]) => {
      const res = await fetch(`/api/challenges/${challengeId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: act }) });
      return { status: res.status, body: await res.json() };
    },
    [id, action] as const,
  );

test.describe("challenges", () => {
  test("challenge, accept, play on Chess.com, automatic verification, statistics", async ({ db, chess, player, pageAs, request }) => {
    const alice = await player({ username: "alice_e2e", name: "Alice Archer", rapid: 1500 });
    const bob = await player({ username: "bob_e2e", name: "Bob Bishop", rapid: 1400 });
    const carol = await player({ username: "carol_e2e", name: "Carol Third" });
    chess.clearGames();

    // --- Alice challenges Bob from his profile.
    const alicePage = await pageAs(alice);
    await alicePage.goto("/players/bob_e2e");
    await alicePage.getByRole("button", { name: "Challenge", exact: true }).click();
    const dialog = alicePage.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Challenge Bob Bishop" })).toBeVisible();
    await dialog.getByLabel(/Time control/).selectOption("600");
    await dialog.getByLabel(/Message/).fill("Free after the lab at 6?");
    await dialog.getByRole("button", { name: "Send challenge" }).click();
    await expect(alicePage).toHaveURL(/\/challenges\/[0-9a-f-]{36}$/);
    const id = alicePage.url().split("/").pop()!;
    await expect(alicePage.getByRole("heading", { name: "vs Bob Bishop" })).toBeVisible();
    await expect(alicePage.getByText("Waiting for them to respond.")).toBeVisible();
    await expect(alicePage.getByText("Free after the lab at 6?")).toBeVisible();

    // A second open challenge to the same person is refused, with a clear reason.
    await alicePage.goto("/players/bob_e2e");
    await alicePage.getByRole("button", { name: "Challenge", exact: true }).click();
    await alicePage.getByRole("dialog").getByRole("button", { name: "Send challenge" }).click();
    await expect(alicePage.getByRole("dialog").getByText(/already have an open challenge with this player/)).toBeVisible();
    expect((await db.admin.query("select count(*)::int as n from public.challenges where challenger_id = $1 and recipient_id = $2", [alice.id, bob.id])).rows[0].n).toBe(1);

    // --- Authorisation is server-side: the challenger cannot accept their own challenge, a bystander cannot even see it.
    const own = await patchChallenge(alicePage, id, "accept");
    expect(own.status).toBe(403);
    const carolPage = await pageAs(carol);
    const hidden = await carolPage.goto(`/challenges/${id}`);
    expect(hidden?.status()).toBe(404);
    expect((await patchChallenge(carolPage, id, "accept")).status).toBe(404);
    expect((await db.admin.query("select status from public.challenges where id = $1", [id])).rows[0].status).toBe("pending");

    // --- Bob is notified and accepts.
    const bobPage = await pageAs(bob);
    await bobPage.goto("/challenges");
    await expect(bobPage.getByText("Challenged by Alice Archer")).toBeVisible();
    await bobPage.getByRole("button", { name: "Accept" }).click();
    await expect.poll(async () => (await db.admin.query("select status from public.challenges where id = $1", [id])).rows[0].status).toBe("accepted");
    await bobPage.goto(`/challenges/${id}`);
    await expect(bobPage.getByRole("heading", { name: "How to play" })).toBeVisible();
    // The honest disclosure: accepting here creates nothing on Chess.com.
    await expect(bobPage.getByText(/does not create a game on Chess\.com/)).toBeVisible();
    expect((await db.as(alice.id).query("select title from public.notifications where type = 'challenge_accepted'")).rows).toHaveLength(1);

    // --- Nothing has been played: the job must not invent a result.
    await db.admin.query("update public.challenges set accepted_at = now() - interval '3 hours', next_check_at = now() - interval '1 second' where id = $1", [id]);
    expect((await cron(request, "sync-challenges", null)).status()).toBe(401);
    expect((await cron(request, "sync-challenges", "not-the-secret-not-the-secret")).status()).toBe(401);
    const idle = await cron(request, "sync-challenges");
    expect(idle.status()).toBe(200);
    expect((await idle.json()).stats).toMatchObject({ claimed: 1, waiting: 1, verified: 0 });
    expect((await db.admin.query("select status from public.challenges where id = $1", [id])).rows[0].status).toBe("waiting_for_game");
    await alicePage.goto(`/challenges/${id}`);
    await expect(alicePage.getByText("Waiting for game").first()).toBeVisible();
    await expect(alicePage.getByText("No finished game between you two yet")).toBeVisible();

    // --- They play: Bob (white) beats Alice. Chess.com publishes the game.
    const game = chess.addGame({ white: "bob_e2e", black: "alice_e2e", winner: "white", endedAt: new Date(Date.now() - 30 * 60_000) });
    await db.admin.query("update public.challenges set next_check_at = now() - interval '1 second' where id = $1", [id]);
    const found = await cron(request, "sync-challenges");
    expect((await found.json()).stats).toMatchObject({ claimed: 1, settling: 1, verified: 0 });
    // Found, but it must remain the only candidate for the whole settle window before it counts.
    expect((await db.admin.query("select status from public.challenges where id = $1", [id])).rows[0].status).toBe("checking_result");
    expect((await db.admin.query("select count(*)::int as n from public.college_matches where challenge_id = $1", [id])).rows[0].n).toBe(0);
    await alicePage.reload();
    await expect(alicePage.getByText("Checking result").first()).toBeVisible();

    // The window closes (time travel in the database; the job itself uses the real clock).
    await db.admin.query("update public.challenges set settle_until = now() - interval '1 minute', next_check_at = now() - interval '1 second' where id = $1", [id]);
    const verified = await cron(request, "sync-challenges");
    expect((await verified.json()).stats).toMatchObject({ claimed: 1, verified: 1 });

    // Running it again changes nothing: the game is never counted twice.
    const again = await cron(request, "run-all");
    expect(again.status()).toBe(200);
    expect((await db.admin.query("select count(*)::int as n from public.college_matches where challenge_id = $1", [id])).rows[0].n).toBe(1);
    const stats = (user: string) => db.admin.query("select wins, losses, draws, games_played, points from public.player_stats where user_id = $1", [user]).then((r) => r.rows[0]);
    expect(await stats(bob.id)).toEqual({ wins: 1, losses: 0, draws: 0, games_played: 1, points: 3 });
    expect(await stats(alice.id)).toEqual({ wins: 0, losses: 1, draws: 0, games_played: 1, points: 0 });

    // --- Both players see the verified result, linked to the real game.
    await alicePage.goto(`/challenges/${id}`);
    await expect(alicePage.getByText("Result verified").first()).toBeVisible();
    await expect(alicePage.getByText("You lost")).toBeVisible();
    await expect(alicePage.getByRole("link", { name: /View the game/ })).toHaveAttribute("href", game.url);
    await bobPage.goto(`/challenges/${id}`);
    await expect(bobPage.getByText("You won")).toBeVisible();
    expect((await db.as(bob.id).query("select title from public.notifications where type = 'match_verified'")).rows).toHaveLength(1);

    // --- It shows up in the public match history and on the college leaderboard.
    await alicePage.goto("/matches");
    const row = alicePage.getByRole("row").filter({ hasText: "bob_e2e" }).filter({ hasText: "alice_e2e" });
    await expect(row.first()).toBeVisible();
    await expect(row.first().getByRole("link", { name: /game/i }).first()).toHaveAttribute("href", game.url);
  });

  test("decline, cancel and expiry leave no result and are told to both sides", async ({ db, player, pageAs, request }) => {
    const dana = await player({ username: "dana_e2e", name: "Dana Declines" });
    const eli = await player({ username: "eli_e2e", name: "Eli Expires" });

    const danaPage = await pageAs(dana);
    const eliPage = await pageAs(eli);

    // Eli challenges Dana; Dana declines (with confirmation).
    await eliPage.goto("/players/dana_e2e");
    await eliPage.getByRole("button", { name: "Challenge", exact: true }).click();
    await eliPage.getByRole("dialog").getByRole("button", { name: "Send challenge" }).click();
    await expect(eliPage).toHaveURL(/\/challenges\/[0-9a-f-]{36}$/);
    const first = eliPage.url().split("/").pop()!;
    await danaPage.goto("/challenges");
    await danaPage.getByRole("button", { name: "Decline" }).click();
    await danaPage.getByRole("alertdialog").getByRole("button", { name: "Decline" }).click();
    await expect.poll(async () => (await db.admin.query("select status from public.challenges where id = $1", [first])).rows[0].status).toBe("declined");
    expect((await db.as(eli.id).query("select count(*)::int as n from public.notifications where type = 'challenge_declined'")).rows[0].n).toBe(1);

    // A declined challenge frees the pair: Eli tries again and then cancels.
    await eliPage.goto("/players/dana_e2e");
    await eliPage.getByRole("button", { name: "Challenge", exact: true }).click();
    await eliPage.getByRole("dialog").getByRole("button", { name: "Send challenge" }).click();
    await expect(eliPage).toHaveURL(/\/challenges\/[0-9a-f-]{36}$/);
    const second = eliPage.url().split("/").pop()!;
    await eliPage.getByRole("button", { name: "Cancel challenge" }).click();
    await eliPage.getByRole("alertdialog").getByRole("button", { name: "Cancel challenge" }).click();
    await expect.poll(async () => (await db.admin.query("select status from public.challenges where id = $1", [second])).rows[0].status).toBe("cancelled");

    // Dana challenges Eli and never gets an answer: the expiry job closes it.
    await danaPage.goto("/players/eli_e2e");
    await danaPage.getByRole("button", { name: "Challenge", exact: true }).click();
    await danaPage.getByRole("dialog").getByRole("button", { name: "Send challenge" }).click();
    await expect(danaPage).toHaveURL(/\/challenges\/[0-9a-f-]{36}$/);
    const third = danaPage.url().split("/").pop()!;
    // Challenge terms are immutable even to trusted roles, so the guard trigger is paused for this one superuser statement.
    const c = await db.admin.connect();
    try {
      await c.query("begin");
      await c.query("alter table public.challenges disable trigger challenges_before_update");
      await c.query("update public.challenges set expires_at = now() - interval '1 minute' where id = $1", [third]);
      await c.query("alter table public.challenges enable trigger challenges_before_update");
      await c.query("commit");
    } finally {
      c.release();
    }
    const expired = await cron(request, "expire-challenges");
    expect(expired.status()).toBe(200);
    expect((await db.admin.query("select status from public.challenges where id = $1", [third])).rows[0].status).toBe("expired");

    // None of the three produced a result or touched statistics.
    expect((await db.admin.query("select count(*)::int as n from public.college_matches where challenge_id = any($1)", [[first, second, third]])).rows[0].n).toBe(0);
    await danaPage.goto("/challenges?tab=history");
    await expect(danaPage.getByText("Expired").first()).toBeVisible();
    await expect(danaPage.getByText("Declined").first()).toBeVisible();
  });

  test("a player who has not finished verification cannot challenge anyone", async ({ db, player, pageAs }) => {
    const target = await player({ username: "target_e2e", name: "Target Player" });
    void target;
    const newcomer = await db.createUser({ name: "Nobody Yet" });
    const page = await pageAs(newcomer);
    await page.goto("/players/target_e2e");
    await expect(page.getByRole("link", { name: /Finish verification to challenge/ })).toBeVisible();
    // The API refuses too, regardless of the UI.
    const refused = await page.evaluate(async (recipient) => {
      const res = await fetch("/api/challenges", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ recipient_id: recipient, time_control: "600", message: null }) });
      return res.status;
    }, (await db.admin.query("select id from public.profiles where display_name = 'Target Player'")).rows[0].id as string);
    expect([401, 403, 409]).toContain(refused);
    expect((await db.admin.query("select count(*)::int as n from public.challenges where challenger_id = $1", [newcomer.id])).rows[0].n).toBe(0);
  });
});
