# Privacy and data handling

This describes what the application stores, who can see it, how long it is kept and how it is removed. The in-app
page `/privacy` says the same in plain language. **This is an engineering description, not legal advice;** the
institute should review it (and the Google consent screen text) before launch.

## What is stored, and who can see it

| Data                                                                                          | Where                                                                      | Visible to                                                                                                                                                  |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google email, Google account name, sign-in timestamps                                         | Supabase Auth (`auth.users`)                                               | The member (their own session), verification admins and super admins (email only), nobody else. **Never public.**                                           |
| Display name, short bio, preferred time controls, "open to challenges"                        | `profiles`                                                                 | Public once the member is approved (the four things on a profile page)                                                                                      |
| Eligibility status and how it was established (email list / domain / admin review)            | `profiles`                                                                 | The member; admins                                                                                                                                          |
| Roll number or note typed into an eligibility review request                                  | `eligibility_requests`                                                     | The member; verification admins                                                                                                                             |
| Chess.com username, Chess.com player id, verification method and time                         | `chess_account_links`                                                      | Readable by anyone for approved members (the username and player id are public on Chess.com; the method and time are shown to members and admins in the UI) |
| Verification claims (code, attempts, review notes)                                            | `chess_link_claims`                                                        | The member; verification admins. The code is meaningful only to the member.                                                                                 |
| Imported Chess.com ratings, records, rating history and the Chess.com avatar URL              | `chess_ratings`, `chess_rating_history`, `profiles`                        | Public for approved members (they are public on Chess.com already)                                                                                          |
| Chess.com games between two members (only those, imported while a challenge is being checked) | `imported_chess_games`                                                     | The two players in the game and admins; everyone else sees only the verified match                                                                          |
| Verified college matches, disputes, challenge history, notifications                          | `college_matches`, `match_disputes`, `challenges`, `notifications`         | Matches: public (players, result, link to the public Chess.com game). The rest: the people involved and admins.                                             |
| Online status                                                                                 | **Not stored.** Supabase Realtime Presence, in memory, while a tab is open | Signed-in members only, and not at all if the member chose **Invisible**.                                                                                   |
| Presence preference (available / busy / invisible)                                            | `profile_settings`                                                         | The member                                                                                                                                                  |
| Audit log of administrator actions (and of linking, verification, deletion)                   | `audit_logs`                                                               | Admins. Append-only: it cannot be edited or deleted through the application.                                                                                |
| Rate-limit counters, job run logs, sync attempts                                              | `app_private.rate_limit_buckets`, `job_runs`, `match_sync_attempts`        | Admins (job and sync logs); counters are internal                                                                                                           |

The application never asks for, receives or stores a Chess.com password, cookie or token. Verification reads only the
public Chess.com profile.

## Retention

Applied by the scheduled `housekeeping` job:

- read notifications: deleted after 90 days (unread ones are kept until read or the account is deleted);
- match sync attempts: deleted after 180 days;
- job run records: deleted after 90 days;
- rate-limit counters: purged when expired.

Everything else is kept until the member deletes their account (below). Audit-log entries are kept so that
administrative decisions stay accountable.

## Deleting an account

**Settings → Delete my account** (type `DELETE`). The server deletes the Supabase Auth user, which cascades to the
profile, settings, Chess.com link and claims, ratings and history, challenges, disputes and notifications.

What remains, deliberately:

- **Verified match records** involving the person stay, so opponents' history and statistics do not change. A match
  keeps the Chess.com **username** and the **link to the public Chess.com game**, but no longer points to any member
  profile, display name, email or other account data. The username is a Chess.com identifier that is public on
  Chess.com; it is not erased from these records. (If the institute's policy requires erasing it too, that is a small
  follow-up: replace the usernames on a deleted member's matches with a random token and keep the Elo key stable.)
- **Audit-log entries** about the person remain (they reference an id that no longer exists).
- The last remaining super admin cannot delete their account until they hand the role over.

Deleting the account does not delete anything on Chess.com or Google.

## Who is an administrator

Roles are stored in the database and enforced there ([ARCHITECTURE.md](ARCHITECTURE.md#security-model)). Every
privileged action (suspension, eligibility changes, verification decisions, result corrections, role and setting
changes) requires a written reason and is recorded in the audit log with the acting administrator.

## Third parties

- **Supabase** hosts the database, authentication and realtime service.
- **Google** authenticates sign-in. Supabase Auth stores what Google returns (email, name, avatar URL); the application uses the email for the eligibility check and the name only as the initial display name suggestion, and does not use Google's avatar (the avatar shown is the member's Chess.com one).
- **Chess.com** public API: the server requests public profile, statistics and game-archive data. Requests carry a
  User-Agent with the club's contact address, as Chess.com requests.
- **Vercel** (or your host) serves the application. No analytics or advertising scripts are included.

## Cookies

Only the Supabase session cookie (strictly necessary for sign-in) and a theme preference stored in the browser.
There is no tracking or advertising.
