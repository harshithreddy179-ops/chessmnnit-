import "server-only";

import type { ChecklistItem } from "@/components/forms/status-checklist";
import type { AppContext } from "@/server/auth";

/** The four independent verification facts for the signed-in user. */
export function buildChecklist(ctx: AppContext): ChecklistItem[] {
  const { profile, link, claim } = ctx;
  return [
    { label: "Google account signed in", state: "done", detail: ctx.user.email ? `Signed in as ${ctx.user.email}. Never shown publicly.` : "You are signed in." },
    {
      label: "College eligibility verified",
      state: profile.eligibility_status === "verified" ? "done" : "todo",
      detail: profile.eligibility_status === "verified" ? "Your Google email matched the approved student list." : profile.eligibility_status === "revoked" ? "Eligibility was withdrawn by an administrator." : "Your account isn’t on the approved student list yet. Request a review.",
    },
    {
      label: "Chess.com ownership verified",
      state: link ? "done" : claim ? "pending" : "todo",
      detail: link ? `Linked to @${link.chess_username}.` : claim?.status === "needs_review" ? `@${claim.chess_username}: waiting for an administrator.` : claim ? `@${claim.chess_username}: add your code to your profile and check.` : "Enter your Chess.com username and prove you own it.",
    },
    {
      label: "Profile complete",
      state: profile.onboarding_completed_at ? "done" : "todo",
      detail: profile.onboarding_completed_at ? "Onboarding finished." : "Finish onboarding.",
    },
  ];
}
