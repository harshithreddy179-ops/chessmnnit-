# Bootstrapping the first administrator

Nobody is an administrator until someone with database-level access makes the first one. This is deliberate: there is
no web route, environment variable or "first user wins" rule that can hand out admin rights.

## Steps

1. Deploy the app and apply the migrations ([DEPLOYMENT.md](DEPLOYMENT.md)).
2. Sign in to the site once with the Google account that should become super admin. This creates the Auth user
   (and a profile). You will land on onboarding — you do not need to finish it.
3. On a trusted machine, put these in `.env.local` (copy from `.env.example`):

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
   SUPABASE_SECRET_KEY=sb_secret_…
   ```

4. Run:

   ```bash
   npm run admin:bootstrap -- you@example.com
   ```

   It calls the database function `bootstrap_super_admin(email)` with the secret key. The function:
   - is executable **only** by the service role (the browser's keys, signed-in members and anonymous visitors cannot call it — covered by `tests/db/rls.test.ts` and `tests/db/sync-admin.test.ts`);
   - finds the Auth user by email (it fails with a clear message if the person has not signed in yet);
   - grants `super_admin` (idempotent — running it twice changes nothing);
   - writes an audit-log entry `role.bootstrap_super_admin` with `actor_kind = system`.

5. Refresh the site: an **Admin** item appears in the navigation. Open **Admin → Admins** to grant other roles, and
   **Admin → Eligibility list** to add the student list.

Alternative without the script: in the Supabase SQL editor run `select public.bootstrap_super_admin('you@example.com');`
(the SQL editor runs as a privileged role).

## Roles

| Role               | Can                                                                                                                                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Super admin        | everything below, plus: roles, global settings, adding whole email domains to the eligibility list                                                                                                 |
| Verification admin | eligibility list and requests, changing or unlinking a player's Chess.com account, account-recovery requests, older ownership claims, user eligibility, retrying a player's sync, suspending users |
| Match moderator    | resolving ambiguous / stuck challenges, entering results, correcting or voiding matches, disputes, suspending users                                                                                |
| Read-only analyst  | overview, users list, sync and job status, audit log. **Cannot change anything.**                                                                                                                  |

Enforcement is in the database (`app_private.require_role` inside every privileged function, and RLS on every table).
The dashboard hides what a role cannot use, but a hand-crafted request is refused by the database regardless — the
browser tests exercise this for each role (`tests/e2e/admin.spec.ts`).

Safeguards: you cannot change your own roles; the last super admin cannot be removed or delete their account; every
grant and revoke needs a written reason and is audited.

## Losing all administrators

Run step 4 again with any signed-in email. It needs the secret key, which is why the key is the real root of trust:
keep it only in your hosting provider's secret store and rotate it if it ever leaks (Supabase → Project Settings →
API Keys).
