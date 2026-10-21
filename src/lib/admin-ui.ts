import type { AppRole } from "@/server/auth";

export const ROLE_LABEL: Record<AppRole, string> = {
  super_admin: "Super admin",
  verification_admin: "Verification admin",
  match_moderator: "Match moderator",
  analyst: "Read-only analyst",
};

export const ROLE_BLURB: Record<AppRole, string> = {
  super_admin:
    "Manages administrators, global settings, student eligibility, account recovery, disputes and all moderation.",
  verification_admin:
    "Reviews Chess.com ownership claims, student eligibility and account recovery.",
  match_moderator: "Resolves disputed results and ambiguous or stuck matches.",
  analyst: "Views analytics, reports and audit logs. Cannot change anything.",
};

/** UX hint only: which roles may use a feature. The database enforces it regardless. */
export function can(roles: readonly AppRole[], needed: readonly AppRole[]): boolean {
  return roles.includes("super_admin") || roles.some((r) => needed.includes(r));
}
