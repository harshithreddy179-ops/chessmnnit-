import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import { bindTestDb, type Player, type TestDb } from "../db/helpers";
import { startFakeChessCom, type FakeChessCom } from "../helpers/fake-chesscom";
import { sessionCookieValue } from "./fake-supabase";
import { appUrl, E2E } from "./env";

interface WorkerFixtures {
  db: TestDb;
  chess: FakeChessCom;
}

interface TestFixtures {
  /** Signs a browser context in as an existing user (a real session cookie, verified server-side). */
  signIn: (context: BrowserContext, user: { id: string; email: string }) => Promise<void>;
  /** Creates (or finds) a fully onboarded, approved player and registers them with the fake Chess.com. */
  player: (opts?: { username?: string; name?: string; rapid?: number }) => Promise<Player>;
  /** A new page already signed in as `user`. */
  pageAs: (user: { id: string; email: string }) => Promise<Page>;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  db: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const db = bindTestDb(E2E.dbName, false);
      await use(db);
      await db.close();
    },
    { scope: "worker" },
  ],
  chess: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const chess = await startFakeChessCom(E2E.chessPort);
      await use(chess);
      await chess.close();
    },
    // Always running: the app is configured to use it, and an absent server would look like "Chess.com unreachable".
    { scope: "worker", auto: true },
  ],

  // eslint-disable-next-line no-empty-pattern
  signIn: async ({}, use) => {
    await use(async (context, user) => {
      await context.addCookies([{ name: "sb-localhost-auth-token", value: sessionCookieValue(user.id, user.email), url: appUrl }]);
    });
  },

  player: async ({ db, chess }, use) => {
    await use(async (opts = {}) => {
      // Idempotent by username: Playwright re-runs beforeAll hooks when it restarts a worker.
      const existing = opts.username
        ? await db.admin.query(
            "select l.user_id, l.chess_player_id::int as pid, u.email from public.chess_account_links l join auth.users u on u.id = l.user_id where l.chess_username = $1",
            [opts.username],
          )
        : { rows: [] as { user_id: string; pid: number; email: string }[] };
      const found = existing.rows[0];
      const p: Player = found
        ? { id: found.user_id, email: found.email, username: opts.username!, playerId: found.pid }
        : await db.onboard({ username: opts.username, name: opts.name });
      chess.setProfile({ username: p.username, player_id: p.playerId, location: "Prayagraj" });
      if (opts.rapid) {
        await db.service.query("select public.record_player_sync($1, true, null, null, null, null, $2::jsonb, 3600)", [
          p.id,
          JSON.stringify([{ time_class: "rapid", rating: opts.rapid, best_rating: opts.rapid + 40, wins: 20, losses: 10, draws: 2 }]),
        ]);
      }
      return p;
    });
  },

  pageAs: async ({ browser, signIn }, use) => {
    const contexts: BrowserContext[] = [];
    await use(async (user) => {
      const context = await browser.newContext({ baseURL: appUrl });
      contexts.push(context);
      await signIn(context, user);
      return context.newPage();
    });
    for (const c of contexts) await c.close();
  },
});

export { expect, appUrl };
