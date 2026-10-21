import type { ImportGameRow } from "@/lib/chess/games";
import type { GameInput } from "@/lib/matching/matcher";
import type { CheckRecord, ClaimedChallenge, SyncStore } from "@/server/sync/store";
import type { TestDb } from "../db/helpers";

/**
 * SyncStore backed by a real PostgreSQL connection acting as `service_role`, calling the
 * very same SQL functions the Supabase implementation calls over PostgREST.
 */
export function createPgSyncStore(db: TestDb): SyncStore {
  const q = db.service.query.bind(db.service);
  return {
    async expireStaleChallenges() {
      return (await q("select public.expire_stale_challenges() as n")).rows[0].n;
    },
    async claimChallenges(limit, lease) {
      const r = await q("select * from public.claim_challenges_for_sync($1, $2)", [limit, lease]);
      return r.rows.map(
        (x): ClaimedChallenge => ({
          id: x.id, status: x.status, challengerUsername: x.challenger_username, recipientUsername: x.recipient_username,
          timeControl: x.time_control, acceptedAt: x.accepted_at, giveupAt: x.giveup_at, settleUntil: x.settle_until,
          checkCount: x.check_count, candidateGameIds: x.candidate_game_ids ?? [],
        }),
      );
    },
    async memberUsernames() {
      return new Set((await q("select chess_username from public.chess_account_links")).rows.map((r) => r.chess_username));
    },
    async settleMinutes() {
      return Number((await q("select value from public.app_settings where key = 'match_settle_minutes'")).rows[0].value);
    },
    async getArchiveState(username, month) {
      const r = await q("select etag, last_modified from public.chess_archive_state where chess_username = $1 and archive_month = $2", [username, month]);
      return r.rows[0] ? { etag: r.rows[0].etag, lastModified: r.rows[0].last_modified } : null;
    },
    async saveArchiveState(username, month, s) {
      await q(
        `insert into public.chess_archive_state (chess_username, archive_month, etag, last_modified, game_count)
         values ($1, $2, $3, $4, $5)
         on conflict (chess_username, archive_month) do update set etag = $3, last_modified = $4, game_count = $5, checked_at = now()`,
        [username, month, s.etag, s.lastModified, s.gameCount],
      );
    },
    async importGames(rows: ImportGameRow[]) {
      return (await q("select public.import_chess_games($1::jsonb) as n", [JSON.stringify(rows)])).rows[0].n;
    },
    async pairGames(a, b, since) {
      const r = await q(
        `select * from public.imported_chess_games
          where ((white_username = $1 and black_username = $2) or (white_username = $2 and black_username = $1)) and ended_at >= $3
          order by ended_at`,
        [a, b, since],
      );
      return r.rows.map(
        (x): GameInput => ({
          id: x.id, whiteUsername: x.white_username, blackUsername: x.black_username, winner: x.winner, timeControl: x.time_control,
          rules: x.rules, startedAt: x.started_at, endedAt: x.ended_at, url: x.game_url, rated: x.rated,
        }),
      );
    },
    async attachedGameIds(ids) {
      if (!ids.length) return new Set();
      const r = await q("select game_id from public.college_matches where game_id = any($1::uuid[])", [ids]);
      return new Set(r.rows.map((x) => x.game_id));
    },
    async recordCheck(r: CheckRecord) {
      await q("select public.record_challenge_check($1, $2, $3, $4, $5, $6::uuid[], $7::jsonb, $8, $9)", [
        r.challengeId, r.outcome, r.newStatus, r.nextCheckAt, r.settleUntil, r.candidates, JSON.stringify(r.detail), r.error ?? null, r.reviewReason ?? null,
      ]);
    },
    async finalizeMatch(challengeId, gameId, evidence) {
      await q("select public.finalize_challenge_match($1, $2, $3::jsonb)", [challengeId, gameId, JSON.stringify(evidence)]);
    },
  };
}
