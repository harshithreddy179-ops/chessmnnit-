# Testing

Three layers, from fast to realistic, plus a list of what they **do not** prove.

| Layer                            | Command             | Needs                  | What it exercises                                                                                                                                                                                                                                                              |
| -------------------------------- | ------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit (5 files)                   | `npm run test:unit` | nothing                | Chess.com client (timeouts, backoff, `Retry-After`, ETag, redirects), game normalisation, the matcher's decisions, presence aggregation, input schemas                                                                                                                         |
| Database + integration (9 files) | `npm run test:db`   | a local PostgreSQL 14+ | The real migrations on a real Postgres; row-level security as each role; one-to-one ownership; challenge state machine; matching and statistics against an independent reference model; leaderboards; admin roles and audit; the sync job against a fake Chess.com HTTP server |
| Browser end-to-end (34 tests)    | `npm run test:e2e`  | PostgreSQL + Chromium  | The built Next.js app in a browser: public pages with real rows, sign-in protection, onboarding, challenges through to an automatically verified result, administration, settings and account deletion                                                                         |

`npm test` runs unit + database together. `npm run check` runs typecheck, lint, all of those and the build.

## Running locally

```bash
docker run -d --name mnnit-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16   # or any local Postgres
export TEST_DATABASE_ADMIN_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres     # default; role may create databases
npm ci
npm test                                  # unit + database
npx playwright install chromium           # first time only (or set PLAYWRIGHT_CHROMIUM_PATH)
npm run test:e2e                          # builds the app, starts everything, runs the browser tests
```

The database tests build **one migrated template database** (the Supabase platform shim, then every file in
`supabase/migrations`, in order — which also proves the migrations apply from scratch) and clone it per test file, so
each file starts from a pristine schema in milliseconds. Tests act as a given user by switching to the `authenticated`
(or `anon`, or `service_role`) database role and setting the JWT claims, so row-level security is evaluated exactly as
Supabase does.

## What the database tests prove

- **Identity** (`identity.test.ts`): claims versus links; one member ↔ one Chess.com account under concurrent attempts;
  immutable identity fields; admin-reviewed recovery; squat resistance; server-issued codes; audit entries.
- **RLS** (`rls.test.ts`): RLS enabled on every table in `public` and `app_private`; every `SECURITY DEFINER` function
  pins its `search_path`; the exact set of functions `anon` and `authenticated` may call; what `anon`, a member and
  another member can read or write; column-level grants (a member can edit only their display fields); admin-looking
  JWT claims are ignored (roles come from the database); notifications are owner-only; rate-limit windows; the audit
  log is append-only even for trusted roles.
- **Challenges** (`challenges.test.ts`): who may create, accept, decline, cancel; illegal transitions; duplicate
  prevention for a pair (even created simultaneously); rate limits; expiry; immutable terms.
- **Matching and statistics** (`matching.test.ts`): the database result against a separate in-test reference
  implementation of points, win rate and Elo, including draws, deletions, disputes and corrections; idempotent recompute.
- **Leaderboards** (`leaderboards.test.ts`): ordering, tie-breakers, minimum sample, per-category separation, paging,
  server-side sorting.
- **Sync flow** (`sync-flow.test.ts`): the real job against a fake Chess.com HTTP server — verification after the settle
  window; ambiguity → review; a second game appearing during the window; delayed archives; games that cannot belong to
  the challenge; unreadable results; partial archive failure; a long `Retry-After`; transient failures with backoff;
  conditional requests; strictly serial requests; expiry in the same run.
- **Open registration and Chess.com links** (`open-registration.test.ts`): accounts start eligible; linking a username
  (validation, case/padding, one-to-one, no self-service change, suspended and signed-out callers, rate limit);
  the student-list setting still gates accounts created while it is on; the administrator "set link" action (typo fix,
  taking a username back from whoever claimed it first, archived history, audit, notifications, role and reason
  checks, no-op and bad input).
- **Identity** (`identity.test.ts`): the older student-list and ownership-claim machinery, exercised with the setting on.
- **Rating sync** (`player-sync.test.ts`): stats mapping, due-player refresh one at a time, and failure/identity-change
  recording that never touches the link.
- **Admin** (`sync-admin.test.ts`): every admin function by role, reasons required, audit entries written, bootstrap
  function privileges.

## What the browser tests prove

Run against the production build (`next build && next start`). The app's Supabase URL points at a **stand-in** server
(`tests/e2e/fake-supabase.ts`) that implements the small PostgREST/GoTrue subset the app uses by executing real SQL
against the real database under real roles; Chess.com is a local fake. Sign-in is simulated with a session cookie
(the app verifies it exactly as it verifies a real one). Nothing is mocked inside the Next.js app.

Specs: `public` (landing counts from real rows, directory, profiles, leaderboards, match history, rules, privacy,
robots, sitemap, real 404s), `auth` (protected routes remember where you were going, forged cookies, cross-site
API requests refused, cron secret), `onboarding` (eligibility review, code-based verification, admin-review fallback,
malformed and unknown usernames, a username owned by someone else can never be claimed), `challenges` (send → accept →
play → cron finds the game → settle window → verified → statistics → history; decline, cancel, expiry; duplicate and
unauthorised actions), `admin` (what each role can see and do, crafted requests refused, role grant/revoke, eligibility,
suspension, ambiguous result → moderator, dispute and ruling, correction, settings, job log), `settings` (validation,
preferences enforced server-side, invisible status, account deletion with history kept, last super admin protected).

## What is NOT proven (be honest about these)

1. **The live Chess.com API.** All Chess.com behaviour is tested against a documentation-modelled stand-in. Run
   `npm run chesscom:probe` against the real API before relying on automatic verification and result sync
   ([CHESSCOM_INTEGRATION.md](CHESSCOM_INTEGRATION.md)).
2. **Supabase Realtime (Presence, Postgres Changes, private-channel authorisation).** The presence _logic_ (merging
   multiple tabs, a grace period before showing offline, "unknown" when disconnected, invisible mode) is pure code with
   unit tests, and the app degrades to "status unavailable" when Realtime is not connected (the browser tests run in that
   mode because the stand-in has no Realtime). The wiring to a real Realtime server — channel authorisation policies,
   reconnects, multi-tab behaviour — has **not** been run. Test it with two browsers after deploying.
3. **Real PostgREST and GoTrue.** The stand-in is a faithful-enough subset, not the product: a query shape the stand-in
   accepts could still behave differently on real PostgREST, and Google sign-in, session refresh, token expiry and
   Auth bans are exercised only through the stand-in.
4. **Google OAuth** (consent screen, redirect URIs) and the **Supabase CLI** configuration were not run.
5. **Visual regression, load and accessibility audits.** The pages were reviewed in dark, light and mobile widths by
   screenshot during development, and form controls are labelled and keyboard-operable by construction, but there is no
   automated accessibility or load test.

## Writing tests

- Database tests: `createTestDb()` in `tests/db/helpers.ts` gives you a fresh clone, `db.as(userId)` acts as a member,
  `db.service` as the server, `db.onboard()` creates a fully verified player. Time-dependent state is arranged with
  direct superuser updates (the application's own rules forbid editing a challenge's terms, so those tests pause the
  guard trigger for one statement).
- Browser tests share one database and one fake Chess.com per run, so create your own users per test and avoid
  assertions about whole-site counts unless you call `resetMembers(db)` first (as `public.spec.ts` does). Prefer
  `.first()` on text that streaming can render twice, and role-based locators over text.
