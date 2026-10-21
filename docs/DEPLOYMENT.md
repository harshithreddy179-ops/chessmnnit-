# Deployment guide

This takes you from an empty Supabase project and an empty Vercel project to a running site.
Every step names where to click or what to run. Anything in this guide that has **not** been exercised
against the real service is marked **(unverified)** — see [Known limitations](../README.md#known-limitations).

Order of work: **1 Supabase → 2 Google OAuth → 3 Deploy the app → 4 First admin → 5 Scheduled jobs → 6 Checks.**

---

## 1. Supabase project

1. Create a project at <https://supabase.com/dashboard> (choose a region near your users, set a strong
   database password and keep it somewhere safe).
2. **Copy the API details** — Project Settings → **API Keys** (and **Data API** for the URL):
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - **Publishable key** (`sb_publishable_…`) → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - **Secret key** (`sb_secret_…`) → `SUPABASE_SECRET_KEY` (server only; never in the browser, never committed).
   - Older projects may only show the legacy `anon` / `service_role` JWT keys. They work too:
     use `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`.
3. **Apply the database schema.** The seven files in `supabase/migrations/` are the whole schema (tables,
   row-level security, functions, grants, realtime). Pick one:

   **Supabase CLI (recommended)**

   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>     # the id in the dashboard URL
   npx supabase db push                                    # applies the migrations in order
   ```

   **SQL editor (no CLI)** — open Dashboard → SQL Editor and run the files **in filename order**
   (`20260101000001_…` through `20260101000007_…`), one at a time. Each file is a complete transaction-safe script;
   stop and read the error if one fails — do not skip ahead.

   Do **not** apply `tests/db/supabase-shim.sql`: it is a stand-in for Supabase internals used only by tests.

4. **Do not run `supabase/seed.sql` here.** It creates fictional demo players and is for local databases only.
   It refuses to run if real members exist, but there is no reason to run it in production.
5. **Authentication → Providers**: leave Email **disabled** (sign-in is Google only; this keeps the verified
   Google email the only identity the eligibility check sees).
6. **Realtime**: nothing to switch on for the tables — migration 7 adds `notifications` and `challenges` to the
   `supabase_realtime` publication, and presence uses a _private_ channel authorised by policies on
   `realtime.messages`. Because the app only uses private channels you can turn **off** public (anonymous)
   channel access in Realtime settings. **(unverified against a live Realtime server — see "Presence" in
   [TESTING.md](TESTING.md).)**
7. **Auth hardening (recommended)**: Authentication → Rate limits (keep defaults), enable CAPTCHA only if you see abuse.

### Row-level security check

After applying the migrations, the Supabase **Security Advisor** (Dashboard → Advisors) should report no
"RLS disabled" tables in `public`. All tables have RLS enabled; the database tests assert this structurally
(see `tests/db/rls.test.ts`). If the advisor flags anything, stop and investigate before launching.

---

## 2. Google OAuth (sign-in)

You create an OAuth client in Google Cloud and paste its ID and secret into Supabase.

1. <https://console.cloud.google.com/> → create or choose a project.
2. **APIs & Services → OAuth consent screen**
   - User type: **Internal** if the institute uses Google Workspace and you are an admin of that domain
     (then only domain accounts can sign in). Otherwise **External**, and publish the app (move it from
     _Testing_ to _In production_) so students are not limited to a test-user list. Basic scopes only
     (`openid`, `email`, `profile`) — no Google verification review is required for those.
   - App name "MNNIT Chess", a support email, and your site's privacy policy URL (`/privacy` is not a page in this
     app; link to the institute's policy or host `docs/PRIVACY.md` as a page of your choice).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application**
   - **Authorized JavaScript origins**: `https://<your-site>` (and `http://localhost:3000` for development)
   - **Authorized redirect URIs**: `https://<your-project-ref>.supabase.co/auth/v1/callback`
     (this is **Supabase's** callback, shown in Supabase → Authentication → Providers → Google).
   - Copy the **Client ID** and **Client secret**.
4. Supabase → **Authentication → Sign In / Providers → Google**: enable, paste the Client ID and secret, save.
5. Supabase → **Authentication → URL Configuration**:
   - **Site URL**: `https://<your-site>`
   - **Redirect URLs** (allow-list): `https://<your-site>/auth/callback`, `http://localhost:3000/auth/callback`,
     and for Vercel preview deployments a wildcard such as `https://*-<your-team>.vercel.app/auth/callback`.
   - The app sends users back to `/auth/callback`; any other URL is rejected by Supabase.

Local development with the Supabase CLI instead uses `supabase/config.toml` and the environment variables
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, with `http://127.0.0.1:54321/auth/v1/callback` added as an authorized
redirect URI. **(unverified: config.toml was written from the CLI reference and not run in this repository's CI.)**

---

## 3. Deploy the app (Vercel)

1. Push the repository to GitHub, then Vercel → **Add New… → Project** → import it. Framework preset: Next.js
   (detected). No build command overrides are needed (`next build`).
2. **Environment variables** (Project → Settings → Environment Variables; set for Production and, if you use
   previews, Preview). All are documented in `.env.example`:

   | Variable                                | Required?   | Scope   | Purpose                                                                                                                                                |
   | --------------------------------------- | ----------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
   | `NEXT_PUBLIC_APP_URL`                   | yes         | browser | Public origin, e.g. `https://chess.mnnit.example`. Used for redirects, canonical URLs, the Chess.com User-Agent.                                       |
   | `NEXT_PUBLIC_SUPABASE_URL`              | yes         | browser | Supabase project URL.                                                                                                                                  |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`  | yes         | browser | Publishable key (or legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY`). Safe in browsers; RLS protects the data.                                                  |
   | `SUPABASE_SECRET_KEY`                   | yes         | server  | Secret key (or legacy `SUPABASE_SERVICE_ROLE_KEY`). Bypasses RLS. Used by scheduled jobs, Chess.com link confirmation, Auth bans and account deletion. |
   | `CRON_SECRET`                           | yes         | server  | ≥ 24 random characters (`openssl rand -hex 32`). Protects `/api/cron/*`. Vercel Cron sends it automatically.                                           |
   | `CHESSCOM_CONTACT_EMAIL`                | recommended | server  | Put in the User-Agent so Chess.com can contact you. Use a monitored inbox.                                                                             |
   | `CHESSCOM_PROFILE_CODE_VERIFICATION`    | no          | server  | `true` (default) or `false` to disable the profile-code ownership check (see [CHESSCOM_INTEGRATION.md](CHESSCOM_INTEGRATION.md)).                      |
   | `CHESSCOM_MIN_REQUEST_INTERVAL_MS`      | no          | server  | Gap between Chess.com requests, default 400.                                                                                                           |
   | `CHESSCOM_REQUEST_TIMEOUT_MS`           | no          | server  | Per-request timeout, default 10000.                                                                                                                    |
   | `CHESSCOM_MAX_RETRIES`                  | no          | server  | Retries with exponential backoff, default 3.                                                                                                           |
   | `CHESSCOM_OAUTH_CLIENT_ID` / `…_SECRET` | no          | server  | Only reported in the admin UI; OAuth is **not implemented** (needs Chess.com approval).                                                                |
   | `PUBLIC_DATA_REVALIDATE_SECONDS`        | no          | server  | Cache lifetime of landing-page data, default 60.                                                                                                       |
   | `CHESSCOM_API_BASE_URL`                 | **never**   | server  | Test-only override of the Chess.com host. Leave unset in production.                                                                                   |

   Only the three `NEXT_PUBLIC_*` variables reach the browser. The build succeeds with **none** of these set
   (CI builds that way on purpose); the site then shows "awaiting configuration" states.

3. Deploy. Visit `/rules` (public, no database needed) to confirm the deployment is up, then `/login`.
4. Add your domain (Project → Settings → Domains), then update `NEXT_PUBLIC_APP_URL`, Supabase **Site URL** and the
   Redirect URLs, and the Google **JavaScript origin** to the final domain.

Security headers (CSP, HSTS, frame-ancestors, etc.) are set in `next.config.ts`. The CSP's `connect-src` is derived
from `NEXT_PUBLIC_SUPABASE_URL` **at build time**, so set that variable before building (changing it later needs a
redeploy).

---

## 4. First administrator

Nobody is an admin until you create one, deliberately, from outside the web app:

1. Sign in once with the Google account that should own the site.
2. Run `npm run admin:bootstrap -- you@example.com` locally with `NEXT_PUBLIC_SUPABASE_URL` and
   `SUPABASE_SECRET_KEY` in `.env.local` (full steps and what it does: [ADMIN_BOOTSTRAP.md](ADMIN_BOOTSTRAP.md)).
3. Open `/admin`. Then add the student list at **Admin → Eligibility list** and grant other roles at **Admin → Admins**.

---

## 5. Scheduled jobs (result sync, expiry, rating refresh)

The server must call `POST|GET /api/cron/run-all` regularly with `Authorization: Bearer <CRON_SECRET>`. It runs, in
order and within one time budget: expire stale challenges → check accepted challenges for finished games → refresh a
batch of players' ratings → housekeeping. Individual jobs: `expire-challenges`, `sync-challenges`, `sync-players`,
`housekeeping`. Browsers never trigger synchronisation. **Use exactly one scheduler:**

| Option                                   | Frequency                                    | Notes                                                                                                                                                                                                    |
| ---------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Vercel Cron** (`vercel.json`, shipped) | **Once a day** (03:00 UTC) on the Hobby plan | Hobby cron runs at most daily; Pro allows per-minute. Results then lag by up to a day — acceptable for ratings, slow for match results. Edit the `schedule` in `vercel.json` on a plan that allows more. |
| **GitHub Actions** (`cron.yml`, shipped) | Every 10 minutes, best effort                | Add repository secrets `APP_URL` and `CRON_SECRET`. Runs only from the default branch; GitHub may delay or skip runs under load. Delete the workflow if you use another option.                          |
| **Supabase pg_cron + pg_net**            | Any (the snippet uses 10 minutes)            | `supabase/optional/pg_cron_schedule.sql`: enable both extensions, store the secret in Vault, replace the URL. **(unverified)**                                                                           |

Recommended for a real launch: keep Vercel's daily call as a safety net and add GitHub Actions (or pg_cron) for the
10-minute cadence. Running two schedulers is harmless — every job is idempotent and claims work with a database
lock — but wasteful.

Manual run / smoke test:

```bash
curl -i -X POST -H "Authorization: Bearer $CRON_SECRET" https://<your-site>/api/cron/run-all
# 200 {"ok":true,"job":"run-all","status":"ok","stats":{…}}   |  401 wrong secret  |  503 not configured
```

Every run is recorded in `job_runs` and listed at **Admin → Sync & jobs**.

The route allows up to 60 s (`maxDuration`); the job stops itself at 50 s and reports `partial`, resuming on the next
call. Chess.com requests are strictly serial with a minimum gap, so a large club needs frequent runs rather than long
ones.

---

## 6. Post-deploy checklist

- [ ] `/login` → "Continue with Google" completes and returns to `/onboarding`.
- [ ] A non-listed email sees "isn't on the approved student list yet" and can request review; a listed email is verified automatically.
- [ ] Admin → Eligibility list: add a test email; sign in with it; confirm it becomes verified.
- [ ] Run `npm run chesscom:probe -- <a-real-chess-com-username>` from a machine with internet access and keep the output
      (see [CHESSCOM_INTEGRATION.md](CHESSCOM_INTEGRATION.md)). If the profile-code check fails, set
      `CHESSCOM_PROFILE_CODE_VERIFICATION=false` and use administrator review.
- [ ] Two real accounts: verify, challenge, accept, play a game on Chess.com, then run the cron call and watch the challenge
      move to **Result verified** (allow the settle window — default 60 min — and Chess.com's data lag).
- [ ] Presence: open the site in two browsers signed in as different members; each should see the other **Available**
      within a few seconds, and **offline** shortly after closing the tab.
- [ ] Security Advisor shows no RLS warnings; **Admin → Sync & jobs** shows the integrations as configured.
- [ ] `include_demo_data` is `false` (Admin → Settings) and `/players` lists only real members.
