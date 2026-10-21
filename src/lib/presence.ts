/**
 * Pure presence logic (no React, no Supabase) so it can be unit tested.
 *
 * Supabase Realtime Presence gives one entry per connected *socket* under each presence key.
 * We use the user id as the key, so a person with three tabs open has three metas under one
 * key. The rules:
 *   - a user is online while at least one meta exists;
 *   - 'available' wins over 'busy' if any tab is available;
 *   - invisible users never track, so they simply look offline to everyone else;
 *   - a user who disappears is kept as still-online for a short grace period, so a page
 *     reload or a brief network drop does not flicker them offline (or hide them forever).
 */
export type PresenceStatus = "available" | "busy";
export type PresenceMode = PresenceStatus | "invisible";
export type DisplayStatus = PresenceStatus | "offline" | "unknown";

export interface PresenceMeta {
  user_id?: string;
  status?: string;
  tab_id?: string;
  online_at?: string;
}
export type PresenceState = Record<string, PresenceMeta[]>;

/** Collapses the raw presence state into one status per user. */
export function aggregatePresence(state: PresenceState): Map<string, PresenceStatus> {
  const out = new Map<string, PresenceStatus>();
  for (const [key, metas] of Object.entries(state)) {
    if (!Array.isArray(metas) || metas.length === 0) continue;
    const anyAvailable = metas.some((m) => m.status === "available");
    out.set(key, anyAvailable ? "available" : "busy");
  }
  return out;
}

export interface TrackedUser {
  status: PresenceStatus;
  /** Last time the user was present in a sync (ms since epoch). */
  lastSeen: number;
}

/**
 * Merges a fresh sync into what we knew before. Users still present are refreshed; users
 * who vanished are retained until `graceMs` has passed since they were last seen.
 */
export function applyGrace(
  previous: ReadonlyMap<string, TrackedUser>,
  current: ReadonlyMap<string, PresenceStatus>,
  now: number,
  graceMs: number,
): Map<string, TrackedUser> {
  const next = new Map<string, TrackedUser>();
  for (const [id, status] of current) next.set(id, { status, lastSeen: now });
  for (const [id, tracked] of previous) {
    if (!next.has(id) && now - tracked.lastSeen < graceMs) next.set(id, tracked);
  }
  return next;
}

export function displayStatus(
  tracked: ReadonlyMap<string, TrackedUser>,
  userId: string,
  connection: "connected" | "connecting" | "unavailable",
): DisplayStatus {
  const hit = tracked.get(userId);
  if (hit) return hit.status;
  // If we are not connected we genuinely do not know; claiming "offline" would be a lie.
  return connection === "connected" ? "offline" : "unknown";
}

export const PRESENCE_CHANNEL = "presence:community";
export const PRESENCE_GRACE_MS = 8_000;

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  available: "Available",
  busy: "Busy",
  offline: "Offline",
  unknown: "Status unavailable",
};
