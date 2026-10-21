# Chess.com integration: what is real, what is assumed, what is pending

**Read this before launch.** The build environment for this project could not reach `api.chess.com` (outbound access
was blocked), so the integration was developed against a local stand-in server whose responses are modelled on
Chess.com's published documentation. Nothing here was exercised against the live service. The stand-in proves the
application's logic; only a run from a machine with internet access proves the assumptions about the real responses.
`npm run chesscom:probe` exists for exactly that — run it once and keep the output.

## Status at a glance

| Capability                                                        | Status                                                                                                                                   |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Public profile, stats, monthly game archives (Published-Data API) | **Implemented**, tested against a documentation-modelled stand-in. **Not yet confirmed live.**                                           |
| Ownership proof by profile code (Location / Name field)           | **Implemented**, tested against the stand-in. Works only if Chess.com's public API returns the edited field; **confirm with the probe.** |
| Ownership proof by administrator review                           | **Implemented and fully tested** (needs no Chess.com access). This is the fallback and is always available.                              |
| Chess.com OAuth ("Sign in with Chess.com")                        | **Not implemented.** Requires Chess.com to approve an application and issue credentials. See below.                                      |
| Creating or accepting games on Chess.com                          | **Impossible by design.** Chess.com offers no public API for it. The app says so and students play on Chess.com themselves.              |

## Endpoints used (read-only, public, unauthenticated)

All via `src/lib/chess/client.ts`, base `https://api.chess.com/pub`:

| Endpoint                                   | Used for                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------ |
| `GET /player/{username}`                   | existence, `player_id`, `status`, `location` / `name` (ownership code), avatar |
| `GET /player/{username}/stats`             | ratings and win/loss/draw records per category (bullet, blitz, rapid, daily)   |
| `GET /player/{username}/games/{YYYY}/{MM}` | the monthly archive, to find the finished game of an accepted challenge        |

No other endpoint is called, and no endpoint is invented. Usernames are validated (`3–25` letters, digits,
underscore, hyphen) and lower-cased before they are placed in a URL path, so a value can never escape its path slot.

## How the client behaves (so it is a good citizen)

- **Strictly serial.** One request at a time per server process, at least `CHESSCOM_MIN_REQUEST_INTERVAL_MS`
  (default 400 ms) apart. Parallel requests are what trigger Chess.com's rate limiting.
- **User-Agent** identifies the app and a contact address (`CHESSCOM_CONTACT_EMAIL`), as Chess.com asks.
- **Timeouts** (default 10 s) and **retries with exponential backoff plus jitter** (default 3) for network errors,
  timeouts and 5xx. A `Retry-After` on a 429 is honoured; if it is longer than the client's cap the job stops instead
  of blocking.
- **Conditional requests.** Archive `ETag` / `Last-Modified` are stored per player-month and sent back; `304` means
  "nothing new" and no work is done.
- **Redirects are not followed.** A `301` means a player was renamed; following it could silently attach a different
  person's games, so it is surfaced for human review.
- **Lenient parsing.** Responses are validated with Zod using loose objects (unknown fields ignored). Each archived
  game is normalised independently, so one malformed game never hides the others, and normalisation never throws.
- **Failures are never results.** A timeout, `429`, partial archive or schema mismatch can only delay a check. It can
  never verify or reject anything.

## Proving a Chess.com account belongs to a member

Goals: only the real owner can link an account, an account can belong to **one** member, and the system never claims
more than it checked. Two routes, shown honestly to the student:

### 1. Profile code (automatic)

1. The member enters a username (or pastes a profile link).
2. The **database** generates a one-time code (`MNNIT-` + 8 unambiguous characters). The client cannot choose it, so it
   cannot point at text already on someone else's profile.
3. The member puts the code in the **Location** field of their own Chess.com profile (Name is also checked) and presses
   **Check my profile**.
4. The server reads the public profile through the API and looks for the code. Only the account owner can edit that
   field, so seeing the code proves control. Nothing else (no password, cookie or token) is ever requested.
5. Only then does a trusted server call link the account — through a database function that holds the one-to-one
   constraints.

Caveat: **Chess.com serves published data through a cache**, so an edit can take a while to appear. "Code not found"
therefore means "not visible yet" and the UI says so; the member can retry later or switch to review. If the live
probe shows the field never appears, set `CHESSCOM_PROFILE_CODE_VERIFICATION=false` and only review is offered.

### 2. Administrator review (always available)

The member explains how an administrator can confirm the account (for example, showing it at the club). A
verification admin decides, with a written reason. The link is recorded with method `admin_review`, an audit entry is
written and the member is notified. It is never silent: a claim waiting for review is visibly not verified.

### One-to-one guarantee

Enforced by the database, not by application code:

- `UNIQUE` on the member (one account per member), on the Chess.com username and on the Chess.com player id (one
  member per account — and a renamed account cannot be claimed twice);
- **claims are not links**: starting a claim reserves nothing, so nobody can squat a username they do not control;
- the link function runs in one transaction; when two requests race, one wins and the other gets a clear
  "already linked" result, and the rejected attempt is audited;
- the link's identity fields are immutable to the member; changing or removing a link is an administrator action
  (recovery requests: a member who lost access to their account asks, and an admin decides, with audit and
  notification of both parties).

### Chess.com OAuth — pending Chess.com approval

Chess.com's OAuth/"Sign in with Chess.com" is available only to applications Chess.com approves and issues client
credentials to. This project does **not** guess OAuth endpoints, scopes or token formats. What exists:

- the verification layer is a provider interface (`src/lib/chess/verification/`) with `profile_code` and
  `admin_review` implemented and an `oauth` provider that reports `awaiting_approval`;
- `CHESSCOM_OAUTH_CLIENT_ID` / `CHESSCOM_OAUTH_CLIENT_SECRET` are read only to report "credentials present, adapter
  missing" in **Admin → Sync & jobs**.

To finish it: apply to Chess.com for API/OAuth access, then implement the provider against the endpoints and scopes
they document for your app, behind the existing interface. Everything that consumes a verified link (one-to-one
rules, audit, notifications) already works with any method.

## Rating sync

A scheduled job (`sync-players`) refreshes a batch of members' stats, oldest first, each on its own interval (6 hours
by default after success, longer backoff after failures). Imported ratings are stored per category with the time they
were fetched and shown with that date. If the stored Chess.com player id no longer matches what Chess.com returns for
the username, or the username comes back different (a rename), the sync records an anomaly
(`player_id_changed` / `username_changed_at_chesscom`), does **not** update ratings, and shows the player in
**Admin → Sync & jobs** for a human decision — it never silently re-points an identity. A failing player never blocks
the others (each has its own error count and backoff).

Known gap: because matching is by username, a student who renames their Chess.com account must be re-linked by an
administrator (the rename is detected, the matches are not followed automatically).

## Automatic match results

Accepting a challenge on the site **does not create anything on Chess.com**. The two students play a game on
Chess.com themselves; the server later finds it in their public archives. The rules (`src/lib/matching/matcher.ts`,
"rules version 1", every decision stores the rules version and its evidence):

A game is a **candidate** only if **all** hold: standard chess (not a variant); played between exactly the two
challenge participants (matched by Chess.com username; the game objects carry no player id we rely on); ended after the
challenge was accepted, and — when the start time is known — did not start before it (2-minute tolerance); the same
time control as the challenge; not already attached to another match.

Then:

- **no candidate** → keep waiting (`waiting_for_game`), re-check with backoff (10, 15, 20, 30, then every 60 minutes);
- **exactly one candidate** → `checking_result`: it must remain the _only_ candidate for the settle window
  (`match_settle_minutes`, default 60) because Chess.com archives lag and a second game may still appear; if it does,
  the challenge becomes ambiguous;
- **more than one candidate** → `needs_review`: the system **never guesses**; a moderator picks the right game
  (by Chess.com link) or enters the result by hand with written evidence;
- **unknown or unsupported result** codes, a partially failed archive read or an error → never verified; retried or
  sent to review;
- **no game by `match_max_wait_hours` (72 h)** → `needs_review` with an explanation to both players.

A verified match is written by one database function that re-checks the game against the challenge, inserts the match
under unique constraints (one match per challenge, per game and per game URL) and recomputes statistics. Re-running the
job is tested to change nothing, and the unique constraints would reject a duplicate even if two runners raced or a
run crashed half-way (the race itself is not load-tested). Players can dispute a result at any time; a
disputed match stops counting immediately.

### Result mapping

Chess.com reports each side's result as a code (`win`, `checkmated`, `resigned`, `timeout`, `abandoned`, …; draws:
`agreed`, `repetition`, `stalemate`, `insufficient`, `timevsinsufficient`, `50move`). The mapping lives in
`src/lib/chess/games.ts` (`deriveWinner`) and is deliberately conservative: anything it does not recognise yields
`unknown`, which routes to a moderator instead of a guess. **The list of draw/loss codes was written from
Chess.com's documentation from memory and should be confirmed against real archives with the probe** (it prints any
game it cannot map).

## Operating it

1. Set `CHESSCOM_CONTACT_EMAIL` to a monitored inbox.
2. Run `npm run chesscom:probe -- <username> [YYYY/MM] --code MNNIT-XXXXXXXX` from a networked machine; put a test code
   in your own Chess.com Location, and re-run until it appears to learn the cache delay. Commit the notes (not any
   credentials) here.
3. Watch **Admin → Sync & jobs** for archive errors, rate-limit outcomes and challenges stuck in review.
