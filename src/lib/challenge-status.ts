import type { Database } from "@/lib/database.types";

export type ChallengeStatus = Database["public"]["Enums"]["challenge_status"];

interface StatusInfo {
  label: string;
  variant: "neutral" | "success" | "warning" | "danger" | "info";
  /** One sentence for the person, from their own point of view. */
  describe: (direction: "sent" | "received") => string;
}

export const STATUS_INFO: Record<ChallengeStatus, StatusInfo> = {
  pending: { label: "Pending", variant: "info", describe: (d) => (d === "sent" ? "Waiting for them to respond." : "Waiting for your response.") },
  accepted: { label: "Accepted", variant: "success", describe: () => "Accepted. Play your game on Chess.com now." },
  declined: { label: "Declined", variant: "neutral", describe: () => "The challenge was declined." },
  cancelled: { label: "Cancelled", variant: "neutral", describe: () => "The challenge was cancelled." },
  expired: { label: "Expired", variant: "neutral", describe: () => "It was not answered in time." },
  waiting_for_game: { label: "Waiting for game", variant: "info", describe: () => "We’re watching Chess.com for your finished game. This can take a while because Chess.com caches its data." },
  checking_result: { label: "Checking result", variant: "warning", describe: () => "We found a likely game and are double-checking that no other game competes with it before recording it." },
  result_verified: { label: "Result verified", variant: "success", describe: () => "The result has been verified and recorded." },
  needs_review: { label: "Needs review", variant: "danger", describe: () => "A moderator will decide this one. It will be resolved from the actual Chess.com game." },
  voided: { label: "Voided", variant: "neutral", describe: () => "Closed without a result by a moderator." },
};

export const ACTIVE_STATUSES: ChallengeStatus[] = ["pending", "accepted", "waiting_for_game", "checking_result", "needs_review"];
export const IN_PLAY_STATUSES: ChallengeStatus[] = ["accepted", "waiting_for_game", "checking_result", "needs_review"];
