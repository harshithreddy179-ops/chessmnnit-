import "server-only";

import type { ChecklistItem } from "@/components/forms/status-checklist";
import type { AppContext } from "@/server/auth";

/** What is true about the signed-in user's account, in the order they usually happen. */
export function buildChecklist(ctx: AppContext): ChecklistItem[] {
  const { profile, link } = ctx;
  const items: ChecklistItem[] = [
    {
      label: "Google account signed in",
      state: "done",
      detail: ctx.user.email
        ? `Signed in as ${ctx.user.email}. Never shown publicly.`
        : "You are signed in.",
    },
  ];
  // Accounts created while registration is open are eligible from the start, so there is nothing to show.
  if (profile.eligibility_source !== "open_registration") {
    items.push({
      label: "College eligibility verified",
      state: profile.eligibility_status === "verified" ? "done" : "todo",
      detail:
        profile.eligibility_status === "verified"
          ? "Your Google email matched the approved student list."
          : profile.eligibility_status === "revoked"
            ? "Eligibility was withdrawn by an administrator."
            : "Your account isn’t on the approved student list yet. Request a review.",
    });
  }
  items.push(
    {
      label: "Chess.com account linked",
      state: link ? "done" : "todo",
      detail: link
        ? `Linked to @${link.chess_username}.`
        : "Enter your Chess.com username so your games and ratings can be found.",
    },
    {
      label: "Profile complete",
      state: profile.onboarding_completed_at ? "done" : "todo",
      detail: profile.onboarding_completed_at ? "Onboarding finished." : "Finish onboarding.",
    },
  );
  return items;
}
