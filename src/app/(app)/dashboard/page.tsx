import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Swords, Users } from "lucide-react";
import { RatingBadge, TimeClassBadge } from "@/components/chess/badges";
import { EmptyState, PageHeader, SectionTitle, Stat } from "@/components/data/primitives";
import { StatusChecklist } from "@/components/forms/status-checklist";
import { ChallengeActions } from "@/components/forms/challenge-actions";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { STATUS_INFO } from "@/lib/challenge-status";
import { TIME_CLASSES } from "@/lib/chess/constants";
import { formatPercent, formatRelative } from "@/lib/utils";
import { requireOnboarded } from "@/server/auth";
import { getMyChallenges, getMyStats, isActiveStatus } from "@/server/data/member";
import { buildChecklist } from "@/server/checklist";

export const metadata: Metadata = { title: "Dashboard", robots: { index: false } };

export default async function DashboardPage() {
  const ctx = await requireOnboarded("/dashboard");
  const [challenges, mine] = await Promise.all([getMyChallenges(ctx.supabase, ctx.user.id, 50), getMyStats(ctx.supabase, ctx.user.id)]);
  const incoming = challenges.filter((c) => c.status === "pending" && c.direction === "received");
  const inPlay = challenges.filter((c) => isActiveStatus(c.status) && c.status !== "pending");
  const outgoing = challenges.filter((c) => c.status === "pending" && c.direction === "sent");
  const games = mine.stats?.games_played ?? 0;
  const checklist = buildChecklist(ctx);

  return (
    <div className="grid gap-10">
      <PageHeader title={`Hello, ${ctx.profile.display_name.split(" ")[0]}`} description="Your challenges, results and verification at a glance." actions={<Button asChild><Link href="/players"><Users aria-hidden /> Find a player</Link></Button>} />

      {!ctx.profile.is_approved ? (
        <section className="grid gap-4">
          <Alert variant="warning" title="You’re not on the leaderboards yet">All four checks below must be complete before you can play ranked college matches or appear in the player list.</Alert>
          <StatusChecklist items={checklist} />
          <div><Button asChild variant="outline"><Link href="/settings">Finish verification <ArrowRight aria-hidden /></Link></Button></div>
        </section>
      ) : null}

      {incoming.length ? (
        <section className="grid gap-3" aria-labelledby="incoming">
          <SectionTitle><span id="incoming">Challenges for you</span></SectionTitle>
          {incoming.map((c) => (
            <Card key={c.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="grid gap-0.5">
                  <Link href={`/challenges/${c.id}`} className="font-medium hover:underline">{c.opponentName} <span className="font-normal text-muted-foreground">@{c.opponentUsername}</span></Link>
                  <p className="text-sm text-muted-foreground">{c.timeControlLabel} · {formatRelative(c.created_at)}{c.message ? ` · “${c.message}”` : ""}</p>
                </div>
                <ChallengeActions id={c.id} direction="received" status={c.status} opponent={c.opponentName} />
              </CardContent>
            </Card>
          ))}
        </section>
      ) : null}

      <section className="grid gap-3">
        <SectionTitle aside={<Button asChild variant="ghost" size="sm"><Link href="/challenges">All challenges <ArrowRight aria-hidden /></Link></Button>}>Games in progress</SectionTitle>
        {inPlay.length === 0 ? (
          <EmptyState icon={Swords} title="No games in progress">Challenge a classmate. Once they accept, play on Chess.com and the result is recorded here automatically.</EmptyState>
        ) : (
          <div className="grid gap-3">
            {inPlay.map((c) => (
              <Link key={c.id} href={`/challenges/${c.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-muted/50">
                <div className="grid gap-0.5"><span className="font-medium">vs {c.opponentName}</span><span className="text-sm text-muted-foreground">{c.timeControlLabel} · {STATUS_INFO[c.status].describe(c.direction)}</span></div>
                <Badge variant={STATUS_INFO[c.status].variant}>{STATUS_INFO[c.status].label}</Badge>
              </Link>
            ))}
          </div>
        )}
        {outgoing.length ? <p className="text-sm text-muted-foreground">{outgoing.length} sent challenge{outgoing.length === 1 ? "" : "s"} waiting for a reply.</p> : null}
      </section>

      <section className="grid gap-4">
        <SectionTitle>My college record</SectionTitle>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Games" value={games} />
          <Stat label="Wins / losses / draws" value={`${mine.stats?.wins ?? 0}/${mine.stats?.losses ?? 0}/${mine.stats?.draws ?? 0}`} />
          <Stat label="Win rate" value={games ? formatPercent(Number(mine.stats?.win_rate)) : "—"} hint={games ? `${mine.stats?.wins} ÷ ${games}` : undefined} />
          <Stat label="College Elo" value={games ? Math.round(Number(mine.stats?.elo)) : "—"} />
        </dl>
      </section>

      <Card>
        <CardHeader><CardTitle>My imported Chess.com ratings</CardTitle></CardHeader>
        <CardContent>
          {mine.ratings.length === 0 ? (
            <p className="text-sm text-muted-foreground">Not imported yet. They’re fetched in the background shortly after verification{mine.sync?.last_error ? ` (last attempt failed: ${mine.sync.last_error})` : ""}.</p>
          ) : (
            <ul className="flex flex-wrap gap-x-8 gap-y-3">
              {TIME_CLASSES.map((c) => mine.ratings.find((r) => r.time_class === c)).filter(Boolean).map((r) => (
                <li key={r!.time_class} className="grid gap-1"><TimeClassBadge timeClass={r!.time_class} /><RatingBadge rating={r!.rating} timeClass={r!.time_class} /></li>
              ))}
            </ul>
          )}
          {mine.sync?.last_success_at ? <p className="mt-3 text-xs text-muted-foreground">Last refreshed {formatRelative(mine.sync.last_success_at)} from the Chess.com public API.</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
