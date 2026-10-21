import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Hourglass,
  Radar,
  ShieldCheck,
  Swords,
  Trophy,
} from "lucide-react";
import { BoardPattern } from "@/components/chess/board-pattern";
import { DemoBadge } from "@/components/chess/badges";
import { EmptyState, SectionTitle } from "@/components/data/primitives";
import { LeaderboardTable } from "@/components/data/leaderboard-table";
import { MatchesTable } from "@/components/data/matches-table";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isSupabaseConfigured } from "@/lib/env";
import { formatRelative } from "@/lib/utils";
import { getSessionUser } from "@/server/auth";
import { getLandingData } from "@/server/data/public";

export const metadata = {
  title: "MNNIT Chess — verified players, college leaderboards, automatic results",
  description:
    "Join MNNIT Allahabad's chess community: link your Chess.com account, challenge classmates and climb leaderboards built from verified results.",
};

const STEPS = [
  {
    icon: ShieldCheck,
    title: "Sign in & prove you're a student",
    body: "Sign in with Google. Your account is matched against the student list kept by the club administrators; if you are not on it you can ask for a manual review.",
  },
  {
    icon: BadgeCheck,
    title: "Prove you own your Chess.com account",
    body: "You add a one-time code to your Chess.com profile and we read your public profile. Typing a username is never enough.",
  },
  {
    icon: Swords,
    title: "Challenge a classmate",
    body: "Pick a time control and send a challenge. If it is accepted you both play on Chess.com. We do not create the game for you.",
  },
  {
    icon: Radar,
    title: "The result is verified for you",
    body: "A background job finds the finished game in both players' Chess.com archives. If anything is unclear (several games, no game, odd result) a moderator decides.",
  },
];

export default async function HomePage() {
  const [user, data] = await Promise.all([getSessionUser(), getLandingData()]);
  const configured = isSupabaseConfigured();
  const summary = data?.summary;
  const show = (n: number | undefined) => (summary ? String(n ?? 0) : "—");

  return (
    <div className="grid gap-16">
      <section className="relative overflow-hidden rounded-2xl border bg-card px-6 py-12 sm:px-12 sm:py-16">
        <BoardPattern />
        <div className="relative grid gap-8 lg:grid-cols-[1.4fr_1fr] lg:items-end">
          <div className="grid gap-6">
            <p className="text-sm font-medium tracking-widest text-primary uppercase">
              MNNIT Allahabad · Chess community
            </p>
            <h1 className="font-display text-5xl leading-[0.95] tracking-tight sm:text-7xl">
              Play real games.
              <br />
              Count real results.
            </h1>
            <p className="max-w-xl text-base text-muted-foreground sm:text-lg">
              A verified chess community for MNNIT students. Link your Chess.com account, challenge
              classmates, and see a college leaderboard built only from results we could actually
              verify.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link href={user ? "/dashboard" : "/login?join=1"}>
                  {user ? "Open my dashboard" : "Join the club"} <ArrowRight aria-hidden />
                </Link>
              </Button>
              {!user ? (
                <Button asChild size="lg" variant="outline">
                  <Link href="/login">Sign in</Link>
                </Button>
              ) : null}
              <Button asChild size="lg" variant="ghost">
                <Link href="/leaderboards">
                  <Trophy aria-hidden /> Leaderboards
                </Link>
              </Button>
            </div>
          </div>
          <dl className="grid grid-cols-3 gap-3 lg:grid-cols-1">
            {[
              ["Verified players", show(summary?.verified_players)],
              ["Verified matches", show(summary?.verified_matches)],
              ["Matches, last 30 days", show(summary?.matches_30d)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border bg-background/70 p-4 backdrop-blur">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="tabular font-mono text-3xl font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {!configured ? (
        <Alert variant="warning" title="This deployment is not connected to its database yet">
          Player counts, leaderboards and sign-in appear once the Supabase environment variables are
          configured. Nothing on this page is placeholder data.
        </Alert>
      ) : data?.error ? (
        <Alert variant="danger" title="Live data could not be loaded">
          Please try again in a moment.
        </Alert>
      ) : null}
      {data?.demo ? (
        <Alert variant="warning" title="Demo data is enabled">
          This instance is showing seeded demo players. Never enable this in production.
        </Alert>
      ) : null}

      <section className="grid gap-6">
        <SectionTitle
          aside={
            <Button asChild variant="ghost" size="sm">
              <Link href="/leaderboards">
                All leaderboards <ArrowRight aria-hidden />
              </Link>
            </Button>
          }
        >
          Leaderboard preview
        </SectionTitle>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Top rapid ratings</CardTitle>
              <CardDescription>
                Imported from Chess.com — not earned only against MNNIT students.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data?.byRating.length ? (
                <LeaderboardTable
                  board="chesscom_rating"
                  rows={data.byRating}
                  caption="Top Chess.com rapid ratings"
                  compact
                />
              ) : (
                <EmptyState icon={Trophy} title="No verified players yet">
                  Ratings appear after players verify their Chess.com accounts.
                </EmptyState>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>College points</CardTitle>
              <CardDescription>
                From verified college matches only: win 3, draw 1, loss 0.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data?.byPoints.length ? (
                <LeaderboardTable
                  board="points"
                  rows={data.byPoints}
                  caption="Top college points"
                  compact
                />
              ) : (
                <EmptyState icon={Swords} title="No verified matches yet">
                  The first verified college match will appear here.
                </EmptyState>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="grid gap-4">
        <SectionTitle
          aside={
            summary?.last_match_at ? (
              <span className="text-xs text-muted-foreground">
                Latest: {formatRelative(summary.last_match_at)}
              </span>
            ) : undefined
          }
        >
          Recently completed matches
        </SectionTitle>
        <Card>
          <CardContent className="p-0 pt-2 sm:p-5">
            {data?.recent.length ? (
              <MatchesTable rows={data.recent} />
            ) : (
              <div className="p-5">
                <EmptyState icon={Hourglass} title="No completed matches yet">
                  Results show up here once both players’ games are found and verified.
                </EmptyState>
              </div>
            )}
          </CardContent>
        </Card>
        {data?.demo && data.recent.length ? <DemoBadge /> : null}
      </section>

      <section className="grid gap-6">
        <SectionTitle>How it works</SectionTitle>
        <ol className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="grid content-start gap-3 rounded-xl border bg-card p-5">
              <span className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-md bg-accent text-accent-foreground">
                  <s.icon className="size-4" aria-hidden />
                </span>
                <span className="tabular font-mono text-xs text-muted-foreground">0{i + 1}</span>
              </span>
              <h3 className="font-semibold">{s.title}</h3>
              <p className="text-sm text-muted-foreground">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid gap-4 rounded-xl border bg-card p-6 sm:p-8">
        <h2 className="font-display text-3xl">What “verified” means here</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Four separate facts are tracked, and only players for whom all four are true appear on
          leaderboards.
        </p>
        <ul className="grid gap-3 text-sm sm:grid-cols-2">
          <li>
            <strong>Google account signed in.</strong> You have logged in; this alone proves nothing
            about college or chess.
          </li>
          <li>
            <strong>College eligibility verified.</strong> Your Google email matched the
            administrators’ student list (or an administrator approved you).
          </li>
          <li>
            <strong>Chess.com ownership verified.</strong> You proved control of the account; a
            username that merely exists is not enough, and an account can belong to only one member.
          </li>
          <li>
            <strong>Profile complete.</strong> You finished onboarding. Suspended accounts are
            hidden.
          </li>
        </ul>
      </section>
    </div>
  );
}
