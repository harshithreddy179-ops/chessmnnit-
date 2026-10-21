import { z } from "zod";
import { TIME_CLASSES } from "@/lib/chess/constants";

/**
 * Input schemas shared by the browser forms and the route handlers, so the client and the
 * server validate identically. The server is the authority; the database re-checks.
 */
const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, "").trim();
const text = (min: number, max: number, label: string) =>
  z
    .string()
    .transform(clean)
    .pipe(z.string().min(min, `${label} must be at least ${min} characters`).max(max, `${label} must be at most ${max} characters`));

export const uuid = z.uuid();
export const timeClass = z.enum(TIME_CLASSES);
export const presenceMode = z.enum(["available", "busy", "invisible"]);
export const appRole = z.enum(["super_admin", "verification_admin", "match_moderator", "analyst"]);

export const displayNameSchema = text(2, 40, "Display name");

export const profileUpdateSchema = z.object({
  display_name: displayNameSchema.optional(),
  bio: z.string().transform(clean).pipe(z.string().max(280)).nullable().optional(),
  preferred_time_classes: z.array(timeClass).max(4).optional(),
  open_to_challenges: z.boolean().optional(),
});

export const presenceSchema = z.object({ presence_mode: presenceMode });

export const chessUsernameInput = z.string().min(1, "Enter your Chess.com username").max(200);
export const claimStartSchema = z.object({ username: chessUsernameInput });
export const claimReviewSchema = z.object({ note: text(10, 1000, "Note") });

export const eligibilityRequestSchema = z.object({
  identifier: text(3, 120, "Roll number or college email"),
  note: z.string().transform(clean).pipe(z.string().max(500)).optional(),
});

export const recoverySchema = z.object({
  kind: z.enum(["change_username", "transfer_username"]),
  username: chessUsernameInput,
  reason: text(10, 1000, "Reason"),
});

export const challengeCreateSchema = z.object({
  recipient_id: uuid,
  time_control: z.string().regex(/^([0-9]+(\+[0-9]+)?|1\/[0-9]+)$/, "Choose a time control"),
  message: z.string().transform(clean).pipe(z.string().max(280, "Keep the message under 280 characters")).nullable().optional(),
});

export const challengeActionSchema = z.object({ action: z.enum(["accept", "decline", "cancel"]) });

export const disputeSchema = z.object({
  reason: text(10, 1000, "Reason"),
  game_url: z
    .string()
    .trim()
    .regex(/^https:\/\/www\.chess\.com\/(game|analysis)\//, "Paste the chess.com game link")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  proposed_result: z.enum(["challenger", "recipient", "draw"]).optional(),
});

export const notificationsReadSchema = z.object({
  ids: z.array(uuid).max(100).optional(),
  all: z.boolean().optional(),
});

export const deleteAccountSchema = z.object({ confirm: z.literal("DELETE") });

const reason = text(5, 500, "Reason");

/** Every administrator action, validated in one place. The database enforces who may perform it. */
export const adminActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("review_claim"), claim_id: uuid, approve: z.boolean(), reason }),
  z.object({ action: z.literal("unlink_account"), user_id: uuid, reason }),
  z.object({ action: z.literal("resolve_recovery"), request_id: uuid, approve: z.boolean(), reason }),
  z.object({
    action: z.literal("add_eligibility"),
    kind: z.enum(["email", "domain"]),
    values: z.array(z.string().trim().toLowerCase().min(3).max(254)).min(1).max(1000),
    note: z.string().transform(clean).pipe(z.string().max(200)).optional(),
  }),
  z.object({ action: z.literal("remove_eligibility"), id: uuid, reason }),
  z.object({ action: z.literal("set_user_eligibility"), user_id: uuid, status: z.enum(["verified", "revoked", "unverified"]), reason }),
  z.object({ action: z.literal("review_eligibility_request"), id: uuid, approve: z.boolean(), reason }),
  z.object({ action: z.literal("set_account_status"), user_id: uuid, suspend: z.boolean(), reason }),
  z.object({ action: z.literal("set_role"), user_id: uuid, role: appRole, grant: z.boolean(), reason }),
  z.object({ action: z.literal("update_setting"), key: z.string().regex(/^[a-z0-9_]{1,64}$/), value: z.union([z.number(), z.boolean(), z.string()]), reason }),
  z.object({ action: z.literal("resolve_with_game"), challenge_id: uuid, game_url: z.string().trim().url().max(300), reason }),
  z.object({
    action: z.literal("manual_result"),
    challenge_id: uuid,
    game_url: z.string().trim().url().max(300),
    winner: z.enum(["challenger", "recipient", "draw"]),
    white_is_challenger: z.boolean(),
    ended_at: z.iso.datetime().optional(),
    reason: text(10, 500, "Evidence"),
  }),
  z.object({ action: z.literal("void_challenge"), challenge_id: uuid, reason }),
  z.object({ action: z.literal("correct_match"), match_id: uuid, result: z.enum(["white", "black", "draw"]), reason }),
  z.object({ action: z.literal("retry_challenge_sync"), challenge_id: uuid }),
  z.object({ action: z.literal("resolve_dispute"), dispute_id: uuid, status: z.enum(["resolved", "rejected"]), note: reason }),
  z.object({ action: z.literal("retry_player_sync"), user_id: uuid }),
]);
export type AdminAction = z.infer<typeof adminActionSchema>;
