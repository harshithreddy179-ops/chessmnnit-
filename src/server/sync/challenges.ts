import { ChessComError, type ChessComClient } from "@/lib/chess/client";
import { monthsBetween, normalizeArchiveGame, type ImportGameRow } from "@/lib/chess/games";
import { evaluateChallenge, nextCheckDelayMs, type ChallengeInput, type Decision } from "@/lib/matching/matcher";
import type { CheckRecord, ClaimedChallenge, SyncStore } from "@/server/sync/store";

type Archives = Pick<ChessComClient, "getMonthlyArchive">;

export interface ChallengeSyncSummary {
  expired: number;
  claimed: number;
  verified: number;
  settling: number;
  waiting: number;
  needsReview: number;
  deferred: number;
  stoppedEarly: boolean;
}

interface RefreshResult {
  ok: boolean;
  rateLimited: boolean;
  imported: number;
  months: string[];
  notes: string[];
}

const MAX_MONTHS = 3;

/**
 * Fetches (conditionally) the monthly archives of BOTH players for every month since the
 * challenge was accepted, and stores any game between two linked members. All fetches must
 * succeed for the pass to count: if one archive is unavailable, a competing game could be
 * hiding in it, so the caller must not verify anything from a partial view.
 */
export async function refreshArchives(
  store: SyncStore,
  client: Archives,
  c: ClaimedChallenge,
  members: ReadonlySet<string>,
  now: Date,
): Promise<RefreshResult> {
  const months = monthsBetween(c.acceptedAt, now).slice(-MAX_MONTHS);
  const result: RefreshResult = { ok: true, rateLimited: false, imported: 0, months, notes: [] };

  for (const username of [c.challengerUsername, c.recipientUsername]) {
    for (const month of months) {
      try {
        const known = await store.getArchiveState(username, month);
        const res = await client.getMonthlyArchive(username, month, known ?? undefined);
        if (res.status === 304 || !res.data) {
          result.notes.push(`${username} ${month}: unchanged`);
          continue;
        }
        const rows: ImportGameRow[] = [];
        let skipped = 0;
        for (const raw of res.data.games) {
          const { game } = normalizeArchiveGame(raw, month);
          if (!game) skipped++;
          else if (members.has(game.white_username) && members.has(game.black_username)) rows.push(game);
        }
        if (rows.length) result.imported += await store.importGames(rows);
        // Validators are saved only after the import succeeded, so a failed import is retried in full.
        await store.saveArchiveState(username, month, { etag: res.etag, lastModified: res.lastModified, gameCount: res.data.games.length });
        result.notes.push(`${username} ${month}: ${res.data.games.length} games, ${rows.length} between members${skipped ? `, ${skipped} unreadable skipped` : ""}`);
      } catch (error) {
        if (error instanceof ChessComError && error.kind === "not_found") {
          result.notes.push(`${username} ${month}: no archive`);
          continue; // no games that month
        }
        result.ok = false;
        if (error instanceof ChessComError && error.kind === "rate_limited") result.rateLimited = true;
        result.notes.push(`${username} ${month}: ${error instanceof ChessComError ? error.kind : "error"}`);
        return result;
      }
    }
  }
  return result;
}

function toInput(c: ClaimedChallenge): ChallengeInput {
  return {
    id: c.id,
    challengerUsername: c.challengerUsername,
    recipientUsername: c.recipientUsername,
    timeControl: c.timeControl,
    acceptedAt: c.acceptedAt,
    giveupAt: c.giveupAt,
    settleUntil: c.settleUntil,
    priorCandidateIds: c.candidateGameIds,
    checkCount: c.checkCount,
  };
}

/** The status a deferred / empty check should leave the challenge in. */
const waitingStatus = (c: ClaimedChallenge): CheckRecord["newStatus"] =>
  c.status === "checking_result" ? "checking_result" : "waiting_for_game";

/**
 * One synchronisation pass for one challenge. Returns what happened for the run summary.
 * Every outcome is persisted as a sync attempt, so the players can see the progress.
 */
export async function processChallenge(
  store: SyncStore,
  client: Archives,
  c: ClaimedChallenge,
  options: { now: Date; settleMinutes: number; members: ReadonlySet<string> },
): Promise<{ kind: Decision["kind"] | "deferred"; rateLimited: boolean }> {
  const { now, settleMinutes, members } = options;
  const refresh = await refreshArchives(store, client, c, members, now);

  if (!refresh.ok) {
    const pastDeadline = c.giveupAt !== null && now.getTime() >= c.giveupAt.getTime();
    await store.recordCheck({
      challengeId: c.id,
      outcome: refresh.rateLimited ? "rate_limited" : "archive_unavailable",
      newStatus: pastDeadline ? "needs_review" : waitingStatus(c),
      nextCheckAt: new Date(now.getTime() + 15 * 60_000),
      settleUntil: c.settleUntil,
      candidates: c.candidateGameIds,
      detail: { notes: refresh.notes },
      reviewReason: pastDeadline ? "Chess.com archives were unavailable for the whole waiting window" : undefined,
    });
    return { kind: "deferred", rateLimited: refresh.rateLimited };
  }

  // Look a little before acceptance so the matcher can explain why earlier games were ignored.
  const since = new Date(c.acceptedAt.getTime() - 6 * 3_600_000);
  const games = await store.pairGames(c.challengerUsername, c.recipientUsername, since);
  const attached = await store.attachedGameIds(games.map((g) => g.id));
  const decision = evaluateChallenge(toInput(c), games, { now, settleMinutes, attachedGameIds: attached });
  const detail = { notes: refresh.notes, rejected: decision.rejected, imported: refresh.imported, months: refresh.months };

  switch (decision.kind) {
    case "no_game":
      await store.recordCheck({
        challengeId: c.id, outcome: "no_game_found", newStatus: "waiting_for_game", nextCheckAt: decision.nextCheckAt,
        settleUntil: null, candidates: [], detail,
      });
      break;
    case "settling":
      await store.recordCheck({
        challengeId: c.id,
        outcome: c.candidateGameIds[0] === decision.candidate.id ? "settling" : "candidate_found",
        newStatus: "checking_result", nextCheckAt: decision.nextCheckAt, settleUntil: decision.settleUntil,
        candidates: [decision.candidate.id], detail: { ...detail, candidate: decision.candidate.url ?? decision.candidate.id },
      });
      break;
    case "verified":
      try {
        await store.finalizeMatch(c.id, decision.game.id, decision.evidence);
      } catch (error) {
        // The database re-checks every invariant. If it refuses, a human decides.
        await store.recordCheck({
          challengeId: c.id, outcome: "error", newStatus: "needs_review", nextCheckAt: null, settleUntil: null,
          candidates: [decision.game.id], detail, error: error instanceof Error ? error.message : "finalize failed",
          reviewReason: "The result could not be recorded automatically",
        });
        return { kind: "ambiguous", rateLimited: false };
      }
      break;
    case "ambiguous":
      await store.recordCheck({
        challengeId: c.id, outcome: "ambiguous", newStatus: "needs_review", nextCheckAt: null, settleUntil: null,
        candidates: decision.candidates.map((g) => g.id), detail: { ...detail, candidates: decision.candidates.map((g) => g.url ?? g.id) },
        reviewReason: decision.reason,
      });
      break;
    case "unknown_result":
      await store.recordCheck({
        challengeId: c.id, outcome: "unknown_result", newStatus: "needs_review", nextCheckAt: null, settleUntil: null,
        candidates: [decision.game.id], detail, reviewReason: decision.reason,
      });
      break;
    case "give_up":
      await store.recordCheck({
        challengeId: c.id, outcome: "gave_up", newStatus: "needs_review", nextCheckAt: null, settleUntil: null,
        candidates: [], detail, reviewReason: decision.reason,
      });
      break;
  }
  return { kind: decision.kind, rateLimited: false };
}

/** Background job: expire stale challenges, then check every challenge that is due. */
export async function runChallengeSync(
  store: SyncStore,
  client: Archives,
  options: { limit: number; deadline: number; now?: () => Date },
): Promise<ChallengeSyncSummary> {
  const summary: ChallengeSyncSummary = {
    expired: 0, claimed: 0, verified: 0, settling: 0, waiting: 0, needsReview: 0, deferred: 0, stoppedEarly: false,
  };
  summary.expired = await store.expireStaleChallenges();
  const settleMinutes = await store.settleMinutes();
  const members = await store.memberUsernames();
  const clock = options.now ?? (() => new Date());

  let remaining = options.limit;
  while (remaining > 0 && Date.now() < options.deadline) {
    const batch = await store.claimChallenges(Math.min(5, remaining), 300);
    if (batch.length === 0) break;
    remaining -= batch.length;
    summary.claimed += batch.length;
    for (const c of batch) {
      if (Date.now() >= options.deadline) {
        summary.stoppedEarly = true;
        break;
      }
      const outcome = await processChallenge(store, client, c, { now: clock(), settleMinutes, members });
      switch (outcome.kind) {
        case "verified": summary.verified++; break;
        case "settling": summary.settling++; break;
        case "no_game": summary.waiting++; break;
        case "deferred": summary.deferred++; break;
        default: summary.needsReview++;
      }
      if (outcome.rateLimited) {
        summary.stoppedEarly = true;
        return summary; // Chess.com asked us to slow down: stop the whole run.
      }
    }
    if (summary.stoppedEarly) break;
  }
  return summary;
}

export { nextCheckDelayMs };
