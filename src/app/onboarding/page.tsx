import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { Alert } from "@/components/ui/alert";
import { ChessLinkForm } from "@/components/forms/chess-link-form";
import { EligibilityPanel } from "@/components/forms/eligibility-panel";
import { FinishOnboarding } from "@/components/forms/finish-onboarding";
import { PreferencesForm, ProfileForm } from "@/components/forms/profile-forms";
import { StatusChecklist } from "@/components/forms/status-checklist";
import { PresenceSwitcher } from "@/components/layout/presence-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { requireContext } from "@/server/auth";
import { buildChecklist } from "@/server/checklist";

export const metadata: Metadata = { title: "Welcome", robots: { index: false } };

function Step({
  n,
  title,
  children,
  done,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
  done?: boolean;
}) {
  return (
    <section className="grid gap-4 rounded-2xl border bg-card p-6" aria-labelledby={`step-${n}`}>
      <h2 id={`step-${n}`} className="flex items-center gap-3 text-lg font-semibold">
        <span
          className={`tabular grid size-7 place-items-center rounded-full font-mono text-xs ${done ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
          aria-hidden
        >
          {done ? "✓" : n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export default async function OnboardingPage() {
  const ctx = await requireContext("/onboarding");
  if (ctx.profile.onboarding_completed_at) redirect("/dashboard");

  // Open registration makes everyone eligible at sign-up. Only when an administrator requires the
  // student list does this step appear: re-check the allowlist on every visit (they may have
  // added the student since last time).
  const status =
    ctx.profile.eligibility_status === "unverified"
      ? ((await ctx.supabase.rpc("claim_eligibility")).data ?? "unverified")
      : ctx.profile.eligibility_status;
  const eligible = status === "verified";
  const { data: openRequest } = eligible
    ? { data: null }
    : await ctx.supabase
        .from("eligibility_requests")
        .select("id")
        .eq("user_id", ctx.user.id)
        .eq("status", "open")
        .maybeSingle();
  const profile = { ...ctx.profile, eligibility_status: status };
  // Accounts created under open registration never had this step; everyone else keeps seeing it (done or not).
  const showEligibility = ctx.profile.eligibility_source !== "open_registration";

  return (
    <div className="min-h-dvh">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Brand />
          <ThemeToggle />
        </div>
      </header>
      <main id="main" className="mx-auto grid max-w-3xl gap-6 px-4 py-10">
        <div className="grid gap-2">
          <h1 className="font-display text-5xl leading-none">Welcome to the club</h1>
          <p className="text-muted-foreground">
            A few quick steps. Your email is never shown publicly, and we never ask for your
            Chess.com password.
          </p>
        </div>
        <StatusChecklist items={buildChecklist({ ...ctx, profile })} />

        <Step n={1} title="Choose your display name" done>
          <ProfileForm displayName={ctx.profile.display_name} bio={ctx.profile.bio} />
        </Step>
        {showEligibility ? (
          <Step n={2} title="Confirm you’re an MNNIT student" done={eligible}>
            <EligibilityPanel
              status={status}
              email={ctx.user.email}
              hasOpenRequest={Boolean(openRequest)}
            />
          </Step>
        ) : null}
        <Step
          n={showEligibility ? 3 : 2}
          title="Add your Chess.com username"
          done={Boolean(ctx.link)}
        >
          {ctx.link ? (
            <p className="text-sm">
              Linked to <strong>@{ctx.link.chess_username}</strong>. If that’s the wrong account, an
              administrator can change it.
            </p>
          ) : eligible ? (
            <ChessLinkForm />
          ) : (
            <Alert variant="info" title="Confirm you’re a student first">
              You can add your Chess.com username once your college eligibility is confirmed.
            </Alert>
          )}
        </Step>
        <Step n={showEligibility ? 4 : 3} title="Your preferences">
          <PreferencesForm
            preferred={ctx.profile.preferred_time_classes}
            open={ctx.profile.open_to_challenges}
          />
          <div className="max-w-xs">
            <PresenceSwitcher id="onboarding-presence" />
          </div>
        </Step>
        <Step n={showEligibility ? 5 : 4} title="Finish">
          <FinishOnboarding
            canFinish={Boolean(ctx.link)}
            approved={Boolean(ctx.link) && eligible}
          />
        </Step>
      </main>
    </div>
  );
}
