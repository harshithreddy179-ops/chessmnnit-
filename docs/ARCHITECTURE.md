# Architecture

## Shape of the system

```
Browser ── Next.js (App Router, Vercel) ──┬── Supabase Postgres  (data, RLS, business rules in SQL functions)
   │          server components,          ├── Supabase Auth      (Google sign-in; session cookie via @supabase/ssr)
   │          route handlers (/api/*),    └── Chess.com public API (server only, serial, rate-limit aware)
   │          scheduled endpoint (/api/cron/*)
   └── Supabase Realtime (presence + change feeds), directly from the browser, authorised by RLS
```

Design rule: **the database is the authority**. Row-level security decides what each caller can read; privileged
changes happen in `SECURITY DEFINER` SQL functions that check the caller's role, enforce the invariants and write the
audit entry in the same transaction. The Next.js layer validates input (Zod), prepares trusted context (for example
reading a Chess.com player id) and presents results. A bug or a hand-crafted request in the web layer therefore cannot
break an invariant the database enforces.

## Code layout

| Path                                  | What lives there                                                                                                       |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/`                | The whole schema: 7 ordered files (foundation, identity, chess data, matchmaking, read APIs, RLS and grants, realtime) |
| `src/app/(site)/`                     | Public pages: landing, players, profiles, leaderboards, matches, rules, privacy, login                                 |
| `src/app/(app)/`                      | Member pages: dashboard, challenges, notifications, settings                                                           |
| `src/app/onboarding`, `admin`, `auth` | Onboarding wizard, administrator dashboard, OAuth callback / sign-out / error                                          |
| `src/app/api/*`                       | JSON route handlers (thin: validate → call database function → map errors)                                             |
| `src/proxy.ts`                        | Refreshes the Supabase session and protects member / admin paths                                                       |
| `src/server/`                         | Server-only code: auth context, API wrapper, data loaders, verification, Chess.com sync, jobs                          |
| `src/lib/chess/`                      | Chess.com client, schemas, game normalisation, verification providers (framework-free, unit-tested)                    |
| `src/lib/matching/`                   | The matcher: a pure function from (challenge, candidate games, clock) to a decision                                    |
| `src/lib/presence.ts`                 | Pure presence logic (merge tabs, grace period, display state)                                                          |
| `src/components/`                     | UI: `ui/` primitives (shadcn-style, Radix + Tailwind), `forms/`, `data/`, `admin/`, `realtime/`, `layout/`             |
| `scripts/`                            | `db-local`, `bootstrap-admin`, `chesscom-probe`, `gen-db-types`                                                        |
| `tests/`                              | `unit`, `db`, `e2e` and shared helpers (fake Chess.com, Supabase stand-in)                                             |

Rendering: classic request-time rendering. Almost every page depends on the signed-in user, so pages are dynamic by
default and the few public aggregates (landing, sitemap players) are cached explicitly with `unstable_cache`.

## Data model

Tables in `public` (all with RLS enabled; internal helpers live in `app_private` and are not exposed):

- **Identity**: `profiles` (1:1 with `auth.users`; display fields, eligibility status, onboarding state, `is_approved`
  derived), `profile_settings` (presence preference), `student_eligibility` (allowlist of emails / domains),
  `eligibility_requests`, `admin_roles`.
- **Chess.com ownership**: `chess_link_claims` (attempts; server-generated code; not an identity), `chess_account_links`
  (the verified one-to-one link), `chess_link_history` (archived links), `account_recovery_requests`.
- **Chess.com data**: `chess_ratings`, `chess_rating_history`, `chess_sync_state`, `chess_archive_state` (ETags),
  `imported_chess_games`.
- **Play**: `supported_time_controls`, `challenges`, `challenge_events` (timeline), `match_sync_attempts` (every automatic
  check and its evidence), `college_matches`, `match_disputes`, `player_stats` (derived).
- **Operations**: `notifications`, `app_settings`, `audit_logs` (append-only), `job_runs`, and `app_private` rate-limit
  buckets.

Key invariants (each has database tests):

- one member ↔ one Chess.com account (`UNIQUE` on member, username and player id; claims reserve nothing);
- a player pair has at most one active challenge (partial unique index on the unordered pair);
- a challenge's terms are immutable after creation; legal state transitions depend on who acts;
- a game is attached to at most one match; a challenge has at most one match;
- statistics are a pure function of verified matches and are recomputed in full under an advisory lock;
- the audit log cannot be updated or deleted;
- clients can write only four profile fields, their presence preference, a challenge's creation fields / status and
  their notifications' read time — nothing else (column-level grants).

### Challenge lifecycle

```
pending ──accept──▶ accepted ──(cron)──▶ waiting_for_game ──▶ checking_result ──▶ result_verified
   │  ╲                                      │                      │
   │   decline / cancel / expire             └──── needs_review ◀───┘   (ambiguous, unreadable result,
   ▼                                                  │                    no game in time, errors)
declined · cancelled · expired                        └─ moderator: pick game / enter result / void ─▶ result_verified | voided
```

Accepting does **not** create a Chess.com game. Result detection rules are in
[CHESSCOM_INTEGRATION.md](CHESSCOM_INTEGRATION.md#automatic-match-results).

## Security model

- **Authentication**: Supabase Auth with Google only. The session cookie is verified server-side on every request
  (`getClaims`, falling back to `getUser`). Anonymous visitors can read only the public views the policies allow.
- **Authorisation**: RLS on every table, deny by default; privileged operations are SQL functions with
  `SECURITY DEFINER`, `search_path = ''`, an explicit role check and an audit write. Which functions each database role
  may execute is asserted by a test. Admin roles are read from `admin_roles`, never from the request or the JWT
  (a forged claim is ignored — tested).
- **Four statuses are kept apart**: Google-authenticated, college eligibility verified, Chess.com ownership verified,
  profile complete. A player is public (`is_approved`) only when all hold; the onboarding checklist shows each one.
- **Secrets**: the Supabase secret key and `CRON_SECRET` are server-only (`server-only` import guard); only three
  `NEXT_PUBLIC_*` values reach the browser. `/api/cron/*` compares a SHA-256 digest of the bearer token in constant
  time and stays closed (503) when no sufficiently long secret is configured.
- **Request hygiene**: Zod validation on every body (32 KB cap), same-origin check on mutating routes, database-backed
  rate limits on claim starts/checks, eligibility and recovery requests, challenges and disputes, errors mapped to
  human messages without leaking internals, security headers and a CSP (`next.config.ts`).
- **Chess.com requests** only ever use validated usernames, never follow redirects and never send credentials.

## Presence and notifications

- **Presence** (`src/components/realtime/presence.tsx`): a Supabase Realtime Presence channel
  (`presence:community`, _private_, authorised by policies on `realtime.messages` so only signed-in members join). Each
  tab tracks a state; the client merges tabs per member, applies a short grace period before showing "offline" (so a
  reload does not flicker) and shows "unknown" rather than "offline" when it cannot reach Realtime. **Invisible** members
  are never tracked, so others see them as offline. Online state is never written to the database.
- **Notifications**: rows inserted by database triggers on state changes (challenge received/accepted/declined/…, match
  verified/needs review, verification and eligibility results, disputes). The browser subscribes to Postgres Changes
  for its own rows (RLS-filtered) for the bell and toasts; the notifications page works without Realtime.

Both rely on Realtime, which is **not covered by automated tests** (see [TESTING.md](TESTING.md#what-is-not-proven-be-honest-about-these)).

## Scheduled jobs

`/api/cron/[job]` with `Authorization: Bearer $CRON_SECRET`: `expire-challenges`, `sync-challenges`, `sync-players`,
`housekeeping`, or `run-all` (in that order, sharing a 50-second budget; the route allows 60 s). Work is claimed with
`FOR UPDATE SKIP LOCKED` and short leases, each run is recorded in `job_runs`, a partial run reports `partial` and
continues next time. Scheduling options are in [DEPLOYMENT.md](DEPLOYMENT.md#5-scheduled-jobs-result-sync-expiry-rating-refresh).
