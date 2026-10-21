# Scoring and leaderboards

Everything below is computed **in the database** from verified college matches, deterministically: the same set of
matches always produces the same numbers and the same order. The public `/rules` page shows the live values of the
settings described here.

## What counts

Only rows in `college_matches` with `status = 'verified'`. A match is created only by the automatic matcher after its
safety checks pass, or by a match moderator with a written reason. **Disputed** matches stop counting immediately and
return when a moderator closes the dispute; **voided** matches never count. Imported Chess.com ratings are a separate
thing and never mix with college statistics.

## Per-player statistics (`player_stats`)

Recomputed in full (not incrementally) whenever a match is inserted, changed or deleted, under an advisory lock, so
retries and concurrent jobs cannot double count and the result never drifts.

| Statistic             | Definition                                                                                                                                                                                                                | Setting                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Games                 | verified matches the player took part in                                                                                                                                                                                  | –                                                |
| Wins / draws / losses | by the recorded result and colour                                                                                                                                                                                         | –                                                |
| Points                | `wins × points_per_win + draws × points_per_draw`; losses score 0                                                                                                                                                         | `points_per_win` = 3, `points_per_draw` = 1      |
| Win rate              | `wins ÷ games` (draws are in the denominator, not counted as wins), rounded to 5 decimals                                                                                                                                 | –                                                |
| College Elo           | everyone starts at `elo_initial_rating`; matches replayed in `(ended_at, id)` order with the standard expected-score formula `1 ÷ (1 + 10^((opp − own) ÷ 400))`, actual score 1 / ½ / 0, update `K × (actual − expected)` | `elo_initial_rating` = 1000, `elo_k_factor` = 32 |
| Provisional           | fewer than `elo_provisional_games` verified matches → labelled provisional in the UI                                                                                                                                      | `elo_provisional_games` = 10                     |
| Last match            | the latest `ended_at` among the player's verified matches                                                                                                                                                                 | –                                                |

If a player deletes their account their matches stay, and their opponents' Elo is still affected by them: the replay
keys such a player by Chess.com username, so history is stable under deletions.

## Leaderboards (`get_leaderboard`)

Only approved members (eligible, Chess.com ownership verified, onboarding complete, not suspended) appear. Sorting,
ranking and paging happen in SQL. **Every ordering ends in `(chess_username, user_id)`**, so ties are broken the same
way every time and ranks never jump between page loads.

| Board                                                                           | Who is listed                                                                                           | Order                                                   |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Chess.com rating (one category: bullet, blitz, rapid or daily — never combined) | has an imported rating in that category                                                                 | rating ↓, then total Chess.com games in that category ↓ |
| College points                                                                  | ≥ 1 verified match                                                                                      | points ↓, wins ↓, games ↑                               |
| College wins                                                                    | ≥ 1 verified match                                                                                      | wins ↓, losses ↑, games ↑                               |
| College Elo                                                                     | ≥ 1 verified match                                                                                      | Elo ↓, games ↓, wins ↓                                  |
| Games played                                                                    | ≥ 1 verified match                                                                                      | games ↓, wins ↓                                         |
| Win rate                                                                        | ≥ `min_games_for_win_rate` (5) verified matches (minimum sample so one lucky game cannot top the board) | win rate ↓, games ↓, wins ↓                             |
| Activity                                                                        | ≥ 1 verified match in the last 30 days                                                                  | matches in 30 days ↓, most recent match ↓               |

## Settings

Stored in `app_settings`, changed by super admins at **Admin → Settings** (a reason is required; every change is
audited). Scoring changes apply the next time statistics are recomputed, which happens on the next match change.

| Key                                                             | Default        | Meaning                                                                              |
| --------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------ |
| `points_per_win` / `points_per_draw`                            | 3 / 1          | match points                                                                         |
| `elo_initial_rating` / `elo_k_factor` / `elo_provisional_games` | 1000 / 32 / 10 | college Elo                                                                          |
| `min_games_for_win_rate`                                        | 5              | minimum sample for the win-rate board                                                |
| `challenge_expiry_hours`                                        | 48             | an unanswered pending challenge expires after this long                              |
| `challenge_max_pending_outgoing`                                | 5              | unanswered challenges one player may have out at once                                |
| `challenge_rate_per_hour`                                       | 10             | challenges one player may create per hour                                            |
| `match_settle_minutes`                                          | 60             | a single candidate game must stay the only candidate this long before it is verified |
| `match_max_wait_hours`                                          | 72             | after this long without a result the challenge goes to a moderator                   |
| `registration_open`                                             | true           | whether new students may complete onboarding                                         |
| `include_demo_data`                                             | false          | show rows flagged `is_demo`; only ever on in local development                       |
