import type { ImportGameRow } from "@/lib/chess/games";
import type { GameInput } from "@/lib/matching/matcher";
import type { Database } from "@/lib/database.types";

export type ChallengeStatus = Database["public"]["Enums"]["challenge_status"];

export interface ClaimedChallenge {
  id: string;
  status: ChallengeStatus;
  challengerUsername: string;
  recipientUsername: string;
  timeControl: string;
  acceptedAt: Date;
  giveupAt: Date | null;
  settleUntil: Date | null;
  checkCount: number;
  candidateGameIds: string[];
}

export interface CheckRecord {
  challengeId: string;
  outcome:
    | "no_game_found" | "candidate_found" | "settling" | "ambiguous" | "unknown_result"
    | "archive_unavailable" | "rate_limited" | "error" | "gave_up";
  newStatus: Exclude<ChallengeStatus, "pending" | "accepted" | "declined" | "cancelled" | "expired" | "result_verified">;
  nextCheckAt: Date | null;
  settleUntil: Date | null;
  candidates: string[];
  detail: Record<string, unknown>;
  error?: string;
  reviewReason?: string;
}

/**
 * Everything the result-synchronisation worker needs from the database. Production wires
 * this to Supabase RPCs (supabase-store.ts); the integration tests wire it to a real
 * PostgreSQL connection, so the orchestration is exercised against the actual SQL.
 */
export interface SyncStore {
  expireStaleChallenges(): Promise<number>;
  claimChallenges(limit: number, leaseSeconds: number): Promise<ClaimedChallenge[]>;
  /** Normalised usernames of every verified, linked member. */
  memberUsernames(): Promise<Set<string>>;
  settleMinutes(): Promise<number>;
  getArchiveState(username: string, month: string): Promise<{ etag: string | null; lastModified: string | null } | null>;
  saveArchiveState(username: string, month: string, state: { etag: string | null; lastModified: string | null; gameCount: number }): Promise<void>;
  importGames(rows: ImportGameRow[]): Promise<number>;
  /** Imported games between exactly these two players (either colour) ending at or after `since`. */
  pairGames(a: string, b: string, since: Date): Promise<GameInput[]>;
  /** Of these game ids, the ones already attached to a college match. */
  attachedGameIds(ids: string[]): Promise<Set<string>>;
  recordCheck(record: CheckRecord): Promise<void>;
  finalizeMatch(challengeId: string, gameId: string, evidence: Record<string, unknown>): Promise<void>;
}
