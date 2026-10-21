import type { Metadata } from "next";
import Link from "next/link";
import { ChessVerification, type ClaimView } from "@/components/forms/chess-verification";
import { ExternalChessLink } from "@/components/data/leaderboard-table";
import { DeleteAccount } from "@/components/forms/delete-account";
import { EligibilityPanel } from "@/components/forms/eligibility-panel";
import { PreferencesForm, ProfileForm } from "@/components/forms/profile-forms";
import { RecoveryForm } from "@/components/forms/recovery-form";
import { StatusChecklist } from "@/components/forms/status-checklist";
import { PresenceSwitcher } from "@/components/layout/presence-switcher";
import { PageHeader } from "@/components/data/primitives";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { describeProviders } from "@/lib/chess/verification/providers";
import { getChessComConfig, getChessComOAuthCredentials } from "@/lib/env.server";
import { formatDate } from "@/lib/utils";
import { requireOnboarded } from "@/server/auth";
import { buildChecklist } from "@/server/checklist";

export const metadata: Metadata = { title: "Settings", robots: { index: false } };

export default async function SettingsPage() {
  const ctx = await requireOnboarded("/settings");
  const [{ data: openRequest }, { data: openRecovery }] = await Promise.all([
    ctx.supabase.from("eligibility_requests").select("id").eq("user_id", ctx.user.id).eq("status", "open").maybeSingle(),
    ctx.supabase.from("account_recovery_requests").select("id").eq("requester_id", ctx.user.id).eq("status", "open").maybeSingle(),
  ]);
  const providers = describeProviders({ profileCodeEnabled: getChessComConfig().profileCodeVerification, oauthCredentialsPresent: getChessComOAuthCredentials() !== null });
  const claim: ClaimView | null = ctx.claim
    ? { status: ctx.claim.status as ClaimView["status"], chess_username: ctx.claim.chess_username, verification_code: ctx.claim.verification_code, code_expires_at: ctx.claim.code_expires_at, attempts: ctx.claim.attempts, last_checked_at: ctx.claim.last_checked_at, last_check_result: ctx.claim.last_check_result, method: ctx.claim.method }
    : null;
  const eligible = ctx.profile.eligibility_status === "verified";

  return (
    <div className="grid gap-10">
      <PageHeader title="Settings" description="Your verification, profile, privacy and account." />

      <section className="grid gap-4" aria-labelledby="verification">
        <h2 id="verification" className="text-lg font-semibold">Verification</h2>
        <StatusChecklist items={buildChecklist(ctx)} />
        {ctx.profile.account_status === "suspended" ? <Alert variant="danger" title="Your account is suspended">You’re hidden from the public lists and can’t start challenges. Contact the club administrators.</Alert> : null}
      </section>

      {!eligible ? (
        <Card><CardHeader><CardTitle>College eligibility</CardTitle></CardHeader><CardContent><EligibilityPanel status={ctx.profile.eligibility_status} email={ctx.user.email} hasOpenRequest={Boolean(openRequest)} /></CardContent></Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Chess.com account</CardTitle>
          <CardDescription>Your verified identity can’t be edited. That protects everyone’s results.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          {ctx.link ? (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <ExternalChessLink username={ctx.link.chess_username} />
                <Badge variant="success">Verified {formatDate(ctx.link.verified_at)}</Badge>
                <Badge variant="neutral">{ctx.link.verification_method === "admin_review" ? "Confirmed by an administrator" : ctx.link.verification_method === "profile_code" ? "Confirmed by profile code" : "Confirmed via OAuth"}</Badge>
              </div>
              <details className="rounded-lg border p-4">
                <summary className="cursor-pointer text-sm font-medium">I need to change or recover my Chess.com link</summary>
                <div className="pt-4"><RecoveryForm hasOpen={Boolean(openRecovery)} /></div>
              </details>
            </>
          ) : (
            <ChessVerification claim={claim} eligible={eligible} providers={providers} />
          )}
        </CardContent>
      </Card>

      <Card><CardHeader><CardTitle>Profile</CardTitle><CardDescription>Display name and bio are public.</CardDescription></CardHeader><CardContent><ProfileForm displayName={ctx.profile.display_name} bio={ctx.profile.bio} /></CardContent></Card>
      <Card><CardHeader><CardTitle>Play preferences</CardTitle></CardHeader><CardContent><PreferencesForm preferred={ctx.profile.preferred_time_classes} open={ctx.profile.open_to_challenges} /></CardContent></Card>

      <Card>
        <CardHeader><CardTitle>Online status & privacy</CardTitle><CardDescription>Presence is live and never stored. Choose <em>Invisible</em> and everyone else sees you as offline.</CardDescription></CardHeader>
        <CardContent className="grid gap-5">
          <div className="max-w-xs"><PresenceSwitcher id="settings-presence" /></div>
          <div className="grid gap-1 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">What other people can see</p>
            <p>Public: display name, bio, Chess.com username and link, imported ratings, college record and match history, and your status unless invisible.</p>
            <p>Never public: your email address, your eligibility details or your verification notes.</p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-danger/30">
        <CardHeader><CardTitle>Delete account</CardTitle><CardDescription>Permanently removes your profile and data. See what happens to match history in the <Link className="underline" href="/rules">rules</Link>.</CardDescription></CardHeader>
        <CardContent><DeleteAccount /></CardContent>
      </Card>
    </div>
  );
}
