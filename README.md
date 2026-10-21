# MNNIT Chess Community

A full-stack platform for the chess players of Motilal Nehru National Institute of Technology Allahabad: verified
students, Chess.com accounts that provably belong to them, live availability, challenges, **automatically verified
match results**, college statistics and leaderboards, and an auditable administrator dashboard.

Next.js (App Router) · TypeScript (strict) · React 19 · Tailwind CSS 4 · Radix/shadcn-style components · Supabase
(Auth with Google, Postgres with row-level security, Realtime) · Zod · Vitest · Playwright.

> This is an independent student project, not affiliated with Chess.com. Chess.com ratings shown on the site are
> **imported data**, labelled with when they were fetched, and are never mixed with college statistics.

## What it does

- **Four separate facts per student**, each shown in an onboarding checklist and enforced independently:
  1. signed in with Google;
  2. **college eligibility verified** (the verified Google email is on an admin-managed list, or an administrator approved a review request);
  3. **Chess.com ownership verified** (one-time code in the public profile, or administrator review);
  4. profile complete.
     Only students with all four are public.
- **One-to-one Chess.com ownership** enforced by the database: an account belongs to one member and a member has one account,
  even under concurrent requests; claims reserve nothing; changes go through audited, admin-reviewed recovery.
- **Player directory, profiles, leaderboards** (Chess.com rating per category — never combined — and college points,
  wins, Elo, games, win rate with a minimum sample, activity), **match history**, deterministic tie-breakers, server-side sorting.
- **Live presence** (available / busy / invisible, multi-tab, reconnect-safe, never stored) and **notifications**.
- **Challenges**: send, accept, decline, cancel, expire, with server-side authorisation, duplicate prevention and rate
  limits. Accepting does **not** create a Chess.com game — the students play on Chess.com.
- **Automatic result sync** from a secret-protected scheduled endpoint: finds the finished game in the two students'
  public archives, waits out a safety window, and **never guesses** — ambiguity, unknown results and missing games go to
  a moderator. Results are idempotent, never counted twice, and can be disputed.
- **Administration** with four roles (super admin, verification admin, match moderator, read-only analyst) enforced in
  the database, mandatory written reasons, and an append-only audit log.
- Settings, account deletion, notifications centre, dark theme (and light), responsive, keyboard-operable, honest
  "awaiting configuration" states when an integration is missing — no fake data, no dead buttons.

## Implemented, configured by you, and pending

| Area                                                          | Status                                                                                                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application, schema, RLS, admin, sync, tests                  | **Implemented** (see [TESTING.md](docs/TESTING.md) for what is and is not proven)                                                                 |
| Supabase project, Google OAuth, Vercel, env vars, cron        | **You configure** — step by step in [DEPLOYMENT.md](docs/DEPLOYMENT.md). Not done in this repository.                                             |
| First administrator                                           | **You run one command** — [ADMIN_BOOTSTRAP.md](docs/ADMIN_BOOTSTRAP.md)                                                                           |
| Live Chess.com API                                            | **Written to the documentation, not yet confirmed live** — run `npm run chesscom:probe` ([CHESSCOM_INTEGRATION.md](docs/CHESSCOM_INTEGRATION.md)) |
| Chess.com OAuth                                               | **Pending Chess.com approval; deliberately not implemented** (no invented endpoints)                                                              |
| Realtime (presence, live notifications) against a real server | **Implemented, not tested live** — verify with two browsers after deploying                                                                       |

## Quick start (local)

Requirements: Node 20.9+ (22 recommended, see `.nvmrc`) and, for the database tests, a local PostgreSQL 14+.

```bash
npm ci
cp .env.example .env.local          # fill in values; the app also runs with none (shows "awaiting configuration")
npm run dev                         # http://localhost:3000
```

With a real Supabase project, set the three `NEXT_PUBLIC_*`/secret variables and apply the migrations
(`npx supabase link --project-ref …` then `npx supabase db push`) — full steps in [DEPLOYMENT.md](docs/DEPLOYMENT.md).

For a database without Supabase (development against plain PostgreSQL) there is a helper that installs a small
platform shim and the migrations, optionally with clearly-labelled **demo data**:

```bash
npm run db:local -- --reset --seed  # LOCAL_DATABASE_URL, default postgres://postgres:postgres@127.0.0.1:5432/mnnit_dev
```

## Commands

| Command                                       | Does                                                                              |
| --------------------------------------------- | --------------------------------------------------------------------------------- |
| `npm run dev` / `build` / `start`             | Next.js                                                                           |
| `npm run typecheck` / `lint` / `format:check` | TypeScript (strict), ESLint, Prettier                                             |
| `npm test`                                    | unit + database tests (needs local PostgreSQL; see [TESTING.md](docs/TESTING.md)) |
| `npm run test:e2e`                            | builds the app and runs the browser tests                                         |
| `npm run check`                               | typecheck + lint + tests + build                                                  |
| `npm run db:local`                            | create/migrate (and `--seed`) a local plain-PostgreSQL database                   |
| `npm run db:types` / `db:types:check`         | regenerate / verify `src/lib/database.types.ts` from the migrations               |
| `npm run admin:bootstrap -- you@example.com`  | make the first super admin                                                        |
| `npm run chesscom:probe -- <username>`        | check the real Chess.com API against what the code expects                        |

## Documentation

- [Deployment](docs/DEPLOYMENT.md) — Supabase, Google OAuth, Vercel, environment variables, scheduled jobs, checklist
- [Architecture](docs/ARCHITECTURE.md) — data model, security model, presence, jobs
- [Chess.com integration](docs/CHESSCOM_INTEGRATION.md) — endpoints, ownership proof, result matching, limits, pending OAuth
- [Scoring](docs/SCORING.md) — points, win rate, Elo, leaderboards, settings
- [Admin bootstrap and roles](docs/ADMIN_BOOTSTRAP.md)
- [Testing](docs/TESTING.md) — what each layer proves and what it does not
- [Privacy](docs/PRIVACY.md) — what is stored, who sees it, retention, deletion

## Known limitations

These are real, not boilerplate:

1. **The Chess.com API was never reached during development** (the build environment blocked it). Behaviour is tested
   against a stand-in modelled on the documentation. The profile-code ownership check depends on Chess.com's public
   profile returning the edited Location/Name field, and the result-code mapping was written from the documentation;
   confirm both with `npm run chesscom:probe`. Administrator-review verification works regardless.
2. **Chess.com publishes data through a cache.** Verification and match results can lag by minutes to hours; the UI
   says so and the matcher is built to wait rather than guess.
3. **Chess.com OAuth is not implemented** (needs Chess.com's approval and documented endpoints).
4. **Realtime was not tested against a live server.** Presence logic is unit-tested; channel authorisation and
   reconnection behaviour need a manual check after deploying. Without Realtime the site works and shows presence as
   unavailable.
5. **The browser tests use a Supabase stand-in** (real SQL, real roles, but not real PostgREST/GoTrue) and a simulated
   sign-in cookie; Google sign-in, the Supabase CLI config and the Vercel/GitHub pipelines have not been run.
6. **Vercel's free (Hobby) cron runs once a day**, which makes match results slow; use the GitHub Actions workflow or
   pg_cron for a 10-minute cadence ([DEPLOYMENT.md](docs/DEPLOYMENT.md#5-scheduled-jobs-result-sync-expiry-rating-refresh)).
7. A student who **renames their Chess.com account** is detected by the rating sync and flagged, but must be re-linked
   by an administrator.
8. After **account deletion**, opponents' verified match records keep the deleted player's Chess.com username (public
   on Chess.com) and the game link, but no member identity ([PRIVACY.md](docs/PRIVACY.md)).
9. `npm audit` reports advisories in the development-only `eslint-config-next` dependency chain; none affect the
   production bundle.
10. The "online only" directory filter applies to the current page of results (presence is not stored, so it cannot be
    filtered in the database).

Next.js 16 has conventions that differ from earlier versions (`src/proxy.ts` replaces `middleware.ts`, async request
APIs); see `AGENTS.md` and `node_modules/next/dist/docs/` before changing framework-level code.
