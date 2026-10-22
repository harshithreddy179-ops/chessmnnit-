import type { Metadata } from "next";
import Link from "next/link";
import { ChessLinkForm } from "@/components/forms/chess-link-form";
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
import { formatDate } from "@/lib/utils";
import { requireOnboarded } from "@/server/auth";
import { buildChecklist } from "@/server/checklist";

export const metadata: Metadata = { title: "Settings", robots: { index: false } };

export default async function SettingsPage() {
  const ctx = await requireOnboarded("/settings");
  const [{ data: openRequest }, { data: openRecovery }] = await Promise.all([
    ctx.supabase
      .from("eligibility_requests")
      .select("id")
      .eq("user_id", ctx.user.id)
      .eq("status", "open")
      .maybeSingle(),
    ctx.supabase
      .from("account_recovery_requests")
      .select("id")
      .eq("requester_id", ctx.user.id)
      .eq("status", "open")
      .maybeSingle(),
  ]);
  const eligible = ctx.profile.eligibility_status === "verified";

  return (
    <div className="grid gap-10">
      <PageHeader
        title="Settings"
        description="Your account, profile, privacy and Chess.com link."
      />

      <section className="grid gap-4" aria-labelledby="account-status">
        <h2 id="account-status" className="text-lg font-semibold">
          Account status
        </h2>
        <StatusChecklist items={buildChecklist(ctx)} />
        {ctx.profile.account_status === "suspended" ? (
          <Alert variant="danger" title="Your account is suspended">
            You’re hidden from the public lists and can’t start challenges. Contact the club
            administrators.
          </Alert>
        ) : null}
      </section>

      {!eligible ? (
        <Card>
          <CardHeader>
            <CardTitle>College eligibility</CardTitle>
          </CardHeader>
          <CardContent>
            <EligibilityPanel
              status={ctx.profile.eligibility_status}
              email={ctx.user.email}
              hasOpenRequest={Boolean(openRequest)}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Chess.com account</CardTitle>
          <CardDescription>
            Your link can’t be edited here, because match results are credited to it. If it’s wrong,
            ask the administrators.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          {ctx.link ? (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <ExternalChessLink username={ctx.link.chess_username} />
                <Badge variant="neutral">Linked {formatDate(ctx.link.verified_at)}</Badge>
                <Badge variant="neutral">
                  {ctx.link.verification_method === "self_declared"
                    ? "Entered by you"
                    : ctx.link.verification_method === "admin_review"
                      ? "Set by an administrator"
                      : ctx.link.verification_method === "profile_code"
                        ? "Confirmed by profile code"
                        : "Confirmed via OAuth"}
                </Badge>
              </div>
              <details className="rounded-lg border p-4">
                <summary className="cursor-pointer text-sm font-medium">
                  My Chess.com link is wrong
                </summary>
                <div className="pt-4">
                  <RecoveryForm hasOpen={Boolean(openRecovery)} />
                </div>
              </details>
            </>
          ) : eligible ? (
            <ChessLinkForm />
          ) : (
            <Alert variant="info" title="Confirm you’re a student first">
              You can add your Chess.com username once your college eligibility is confirmed.
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Display name and bio are public.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm displayName={ctx.profile.display_name} bio={ctx.profile.bio} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Play preferences</CardTitle>
        </CardHeader>
        <CardContent>
          <PreferencesForm
            preferred={ctx.profile.preferred_time_classes}
            open={ctx.profile.open_to_challenges}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Online status & privacy</CardTitle>
          <CardDescription>
            Presence is live and never stored. Choose <em>Invisible</em> and everyone else sees you
            as offline.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="max-w-xs">
            <PresenceSwitcher id="settings-presence" />
          </div>
          <div className="grid gap-1 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">What other people can see</p>
            <p>
              Public: display name, bio, Chess.com username and link, imported ratings, college
              record and match history, and your status unless invisible.
            </p>
            <p>
              Never public: your email address, your eligibility details or your verification notes.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-danger/30">
        <CardHeader>
          <CardTitle>Delete account</CardTitle>
          <CardDescription>
            Permanently removes your profile and data. See what happens to match history in the{" "}
            <Link className="underline" href="/rules">
              rules
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DeleteAccount />
        </CardContent>
      </Card>
    </div>
  );
}
