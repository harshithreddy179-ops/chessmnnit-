import "server-only";

import type { Db } from "@/lib/supabase/server";
import type { Json } from "@/lib/database.types";
import type { GameInput } from "@/lib/matching/matcher";
import type { SyncStore } from "@/server/sync/store";

type Res<D> = { data: D; error: { message: string } | null };

/** Throws on a database error; otherwise returns the data exactly as typed (possibly null). */
function check<D>(res: Res<D>): D {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

/** Same, for list queries: never null. */
function rows<D>(res: Res<D[] | null>): D[] {
  return check(res) ?? [];
}

const PAGE = 1000; // PostgREST returns at most 1000 rows per request

/** Production SyncStore: service-role Supabase calls. Each method is a single query / RPC. */
export function createSupabaseSyncStore(admin: Db): SyncStore {
  const toGame = (r: {
    id: string; white_username: string; black_username: string; winner: string; time_control: string | null;
    rules: string; started_at: string | null; ended_at: string; game_url: string; rated: boolean | null;
  }): GameInput => ({
    id: r.id,
    whiteUsername: r.white_username,
    blackUsername: r.black_username,
    winner: r.winner as GameInput["winner"],
    timeControl: r.time_control,
    rules: r.rules,
    startedAt: r.started_at ? new Date(r.started_at) : null,
    endedAt: new Date(r.ended_at),
    url: r.game_url,
    rated: r.rated,
  });

  return {
    async expireStaleChallenges() {
      return check(await admin.rpc("expire_stale_challenges")) ?? 0;
    },

    async claimChallenges(limit, leaseSeconds) {
      const claimed = rows(await admin.rpc("claim_challenges_for_sync", { p_limit: limit, p_lease_seconds: leaseSeconds }));
      return claimed.map((r) => ({
        id: r.id,
        status: r.status,
        challengerUsername: r.challenger_username,
        recipientUsername: r.recipient_username,
        timeControl: r.time_control,
        acceptedAt: new Date(r.accepted_at as string),
        giveupAt: r.giveup_at ? new Date(r.giveup_at) : null,
        settleUntil: r.settle_until ? new Date(r.settle_until) : null,
        checkCount: r.check_count,
        candidateGameIds: r.candidate_game_ids ?? [],
      }));
    },

    async memberUsernames() {
      const names = new Set<string>();
      for (let from = 0; ; from += PAGE) {
        const page = rows(
          await admin.from("chess_account_links").select("chess_username").order("chess_username").range(from, from + PAGE - 1),
        );
        for (const r of page) names.add(r.chess_username);
        if (page.length < PAGE) break;
      }
      return names;
    },

    async settleMinutes() {
      const row = check(await admin.from("app_settings").select("value").eq("key", "match_settle_minutes").maybeSingle());
      return typeof row?.value === "number" && row.value >= 0 ? row.value : 60;
    },

    async getArchiveState(username, month) {
      const row = check(
        await admin.from("chess_archive_state").select("etag,last_modified").eq("chess_username", username).eq("archive_month", month).maybeSingle(),
      );
      return row ? { etag: row.etag, lastModified: row.last_modified } : null;
    },

    async saveArchiveState(username, month, state) {
      check(
        await admin.from("chess_archive_state").upsert(
          { chess_username: username, archive_month: month, etag: state.etag, last_modified: state.lastModified, game_count: state.gameCount, checked_at: new Date().toISOString() },
          { onConflict: "chess_username,archive_month" },
        ),
      );
    },

    async importGames(rows) {
      return check(await admin.rpc("import_chess_games", { p_games: rows as unknown as Json })) ?? 0;
    },

    async pairGames(a, b, since) {
      const cols = "id,white_username,black_username,winner,time_control,rules,started_at,ended_at,game_url,rated";
      const [ab, ba] = await Promise.all([
        admin.from("imported_chess_games").select(cols).eq("white_username", a).eq("black_username", b).gte("ended_at", since.toISOString()),
        admin.from("imported_chess_games").select(cols).eq("white_username", b).eq("black_username", a).gte("ended_at", since.toISOString()),
      ]);
      return [...rows(ab), ...rows(ba)].map(toGame).sort((x, y) => x.endedAt.getTime() - y.endedAt.getTime());
    },

    async attachedGameIds(ids) {
      if (ids.length === 0) return new Set();
      const matched = rows(await admin.from("college_matches").select("game_id").in("game_id", ids));
      return new Set(matched.map((r) => r.game_id).filter((id): id is string => id !== null));
    },

    async recordCheck(r) {
      check(
        await admin.rpc("record_challenge_check", {
          p_challenge_id: r.challengeId,
          p_outcome: r.outcome,
          p_new_status: r.newStatus,
          p_next_check_at: r.nextCheckAt?.toISOString(),
          p_settle_until: r.settleUntil?.toISOString(),
          p_candidates: r.candidates,
          p_detail: r.detail as Json,
          p_error: r.error,
          p_review_reason: r.reviewReason,
        }),
      );
    },

    async finalizeMatch(challengeId, gameId, evidence) {
      check(await admin.rpc("finalize_challenge_match", { p_challenge_id: challengeId, p_game_id: gameId, p_evidence: evidence as Json }));
    },
  };
}
