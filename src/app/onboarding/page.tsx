import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { ChessVerification, type ClaimView } from "@/components/forms/chess-verification";
import { EligibilityPanel } from "@/components/forms/eligibility-panel";
import { FinishOnboarding } from "@/components/forms/finish-onboarding";
import { PreferencesForm, ProfileForm } from "@/components/forms/profile-forms";
import { StatusChecklist } from "@/components/forms/status-checklist";
import { PresenceSwitcher } from "@/components/layout/presence-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { describeProviders } from "@/lib/chess/verification/providers";
import { getChessComConfig, getChessComOAuthCredentials } from "@/lib/env.server";
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

  // Re-check the allowlist on every visit: administrators may have added the student since last time.
  const status =
    ctx.profile.eligibility_status === "unverified"
      ? ((await ctx.supabase.rpc("claim_eligibility")).data ?? "unverified")
      : ctx.profile.eligibility_status;
  const { data: openRequest } = await ctx.supabase
    .from("eligibility_requests")
    .select("id")
    .eq("user_id", ctx.user.id)
    .eq("status", "open")
    .maybeSingle();
  const eligible = status === "verified";
  const profile = { ...ctx.profile, eligibility_status: status };
  const providers = describeProviders({
    profileCodeEnabled: getChessComConfig().profileCodeVerification,
    oauthCredentialsPresent: getChessComOAuthCredentials() !== null,
  });
  const claim: ClaimView | null = ctx.claim
    ? {
        status: ctx.claim.status as ClaimView["status"],
        chess_username: ctx.claim.chess_username,
        verification_code: ctx.claim.verification_code,
        code_expires_at: ctx.claim.code_expires_at,
        attempts: ctx.claim.attempts,
        last_checked_at: ctx.claim.last_checked_at,
        last_check_result: ctx.claim.last_check_result,
        method: ctx.claim.method,
      }
    : null;

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
            Five short steps. Your email is never shown publicly, and we never ask for your
            Chess.com password.
          </p>
        </div>
        <StatusChecklist items={buildChecklist({ ...ctx, profile })} />

        <Step n={1} title="Choose your display name" done>
          <ProfileForm displayName={ctx.profile.display_name} bio={ctx.profile.bio} />
        </Step>
        <Step n={2} title="Confirm you’re an MNNIT student" done={eligible}>
          <EligibilityPanel
            status={status}
            email={ctx.user.email}
            hasOpenRequest={Boolean(openRequest)}
          />
        </Step>
        <Step n={3} title="Link and verify your Chess.com account" done={Boolean(ctx.link)}>
          {ctx.link ? (
            <p className="text-sm">
              Verified: <strong>@{ctx.link.chess_username}</strong>.
            </p>
          ) : (
            <ChessVerification claim={claim} eligible={eligible} providers={providers} />
          )}
        </Step>
        <Step n={4} title="Your preferences">
          <PreferencesForm
            preferred={ctx.profile.preferred_time_classes}
            open={ctx.profile.open_to_challenges}
          />
          <div className="max-w-xs">
            <PresenceSwitcher id="onboarding-presence" />
          </div>
        </Step>
        <Step n={5} title="Finish">
          <FinishOnboarding
            canFinish={Boolean(ctx.link || claim)}
            approved={Boolean(ctx.link) && eligible}
          />
        </Step>
      </main>
    </div>
  );
}
