import type { Winner } from "@/lib/chess/games";

/**
 * Decides whether a Chess.com game may be attached to an accepted challenge.
 *
 * Chess.com archives do not say which website challenge produced a game, may lag, and two
 * students can play several games. So the rules below are strict and any doubt ends in
 * human review rather than a guess:
 *
 *  1. A candidate must be a standard-chess game between exactly the two challenge players.
 *  2. It must have ended after the challenge was accepted (and, when the start time is
 *     known, must not have started before acceptance).
 *  3. Its time control must equal the agreed one; a missing time control is "not
 *     determinable" and allowed, a different one is not.
 *  4. Games already attached to another match never qualify.
 *  5. Exactly one candidate -> it must stay the ONLY candidate for a settle window
 *     (archives lag, a second game may still appear) before it is verified.
 *  6. Two or more candidates -> ambiguous -> needs review. The first game found is never
 *     assumed to be the intended one.
 *  7. A candidate without a decisive/draw result is never counted.
 */
export const MATCH_RULES_VERSION = 1;

export interface ChallengeInput {
  id: string;
  challengerUsername: string;
  recipientUsername: string;
  /** Agreed time control as Chess.com spells it, e.g. "600" or "180+2". */
  timeControl: string;
  acceptedAt: Date;
  giveupAt: Date | null;
  settleUntil: Date | null;
  /** Candidate game ids recorded by the previous check. */
  priorCandidateIds: string[];
  checkCount: number;
}

export interface GameInput {
  id: string;
  whiteUsername: string;
  blackUsername: string;
  winner: Winner;
  timeControl: string | null;
  rules: string;
  startedAt: Date | null;
  endedAt: Date;
  url?: string;
  rated?: boolean | null;
}

export type RejectionReason =
  | "already_counted"
  | "unsupported_variant"
  | "ended_before_acceptance"
  | "started_before_acceptance"
  | "time_control_mismatch";

export interface Rejection {
  gameId: string;
  reason: RejectionReason;
}

export type Decision =
  | { kind: "no_game"; nextCheckAt: Date; giveUp: false; rejected: Rejection[] }
  | { kind: "give_up"; rejected: Rejection[]; reason: string }
  | {
      kind: "settling";
      candidate: GameInput;
      settleUntil: Date;
      nextCheckAt: Date;
      rejected: Rejection[];
    }
  | { kind: "verified"; game: GameInput; evidence: Record<string, unknown>; rejected: Rejection[] }
  | { kind: "ambiguous"; candidates: GameInput[]; reason: string; rejected: Rejection[] }
  | { kind: "unknown_result"; game: GameInput; reason: string; rejected: Rejection[] };

export interface EvaluateOptions {
  now: Date;
  settleMinutes: number;
  /** Game ids already attached to any college match. */
  attachedGameIds: ReadonlySet<string>;
}

const MIN = 60_000;
/** Tolerates small clock differences between Chess.com and this server. */
const START_TOLERANCE_MS = 2 * MIN;

/** Wait before re-checking when no game has been found yet: 10, 15, 20, 30 minutes, then hourly. */
export function nextCheckDelayMs(checkCount: number): number {
  const schedule = [10, 15, 20, 30];
  return (schedule[checkCount] ?? 60) * MIN;
}

function samePair(game: GameInput, c: ChallengeInput): boolean {
  const a = c.challengerUsername;
  const b = c.recipientUsername;
  return (
    (game.whiteUsername === a && game.blackUsername === b) ||
    (game.whiteUsername === b && game.blackUsername === a)
  );
}

export function evaluateChallenge(
  challenge: ChallengeInput,
  games: GameInput[],
  options: EvaluateOptions,
): Decision {
  const { now, settleMinutes, attachedGameIds } = options;
  const rejected: Rejection[] = [];
  const candidates: GameInput[] = [];

  for (const game of games) {
    if (!samePair(game, challenge)) continue; // not a game between these two players: irrelevant
    const reject = (reason: RejectionReason) => rejected.push({ gameId: game.id, reason });
    if (attachedGameIds.has(game.id)) reject("already_counted");
    else if (game.rules !== "chess") reject("unsupported_variant");
    else if (game.endedAt.getTime() < challenge.acceptedAt.getTime())
      reject("ended_before_acceptance");
    else if (
      game.startedAt &&
      game.startedAt.getTime() < challenge.acceptedAt.getTime() - START_TOLERANCE_MS
    )
      reject("started_before_acceptance");
    else if (game.timeControl !== null && game.timeControl !== challenge.timeControl)
      reject("time_control_mismatch");
    else candidates.push(game);
  }

  if (candidates.length >= 2) {
    return {
      kind: "ambiguous",
      candidates,
      rejected,
      reason: `${candidates.length} completed games between these players match the challenge; a moderator must choose`,
    };
  }

  if (candidates.length === 0) {
    if (challenge.giveupAt && now.getTime() >= challenge.giveupAt.getTime()) {
      return {
        kind: "give_up",
        rejected,
        reason: "no matching Chess.com game was found within the allowed window",
      };
    }
    return {
      kind: "no_game",
      giveUp: false,
      rejected,
      nextCheckAt: new Date(now.getTime() + nextCheckDelayMs(challenge.checkCount)),
    };
  }

  const game = candidates[0]!;
  if (game.winner === "unknown") {
    return {
      kind: "unknown_result",
      game,
      rejected,
      reason: "Chess.com did not report a clear win, loss or draw for the only matching game",
    };
  }

  const sameAsBefore =
    challenge.priorCandidateIds.length === 1 && challenge.priorCandidateIds[0] === game.id;
  if (sameAsBefore && challenge.settleUntil && now.getTime() >= challenge.settleUntil.getTime()) {
    return {
      kind: "verified",
      game,
      rejected,
      evidence: {
        rules_version: MATCH_RULES_VERSION,
        accepted_at: challenge.acceptedAt.toISOString(),
        game_url: game.url ?? null,
        game_ended_at: game.endedAt.toISOString(),
        game_started_at: game.startedAt?.toISOString() ?? null,
        checks: {
          players_match: true,
          ended_after_acceptance: true,
          started_after_acceptance: game.startedAt ? true : "unknown",
          time_control: game.timeControl === null ? "unknown" : "match",
          variant: game.rules,
          only_candidate: true,
          settle_minutes: settleMinutes,
        },
        rejected_games: rejected,
        verified_at: now.toISOString(),
      },
    };
  }

  // First sighting (or the candidate changed): start / continue the settle window.
  const settleUntil =
    sameAsBefore && challenge.settleUntil
      ? challenge.settleUntil
      : new Date(now.getTime() + settleMinutes * MIN);
  return {
    kind: "settling",
    candidate: game,
    settleUntil,
    nextCheckAt: new Date(settleUntil.getTime() + MIN),
    rejected,
  };
}
