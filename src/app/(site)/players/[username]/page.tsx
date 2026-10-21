import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarDays, Info } from "lucide-react";
import {
  CollegeBadge,
  DemoBadge,
  RatingBadge,
  TimeClassBadge,
  VerifiedChessBadge,
} from "@/components/chess/badges";
import { ExternalChessLink } from "@/components/data/leaderboard-table";
import { MatchesTable } from "@/components/data/matches-table";
import { EmptyState, SectionTitle, Stat } from "@/components/data/primitives";
import { RatingChart } from "@/components/data/rating-chart";
import { ChallengeButton } from "@/components/forms/challenge-dialog";
import { PresenceDot } from "@/components/realtime/presence";
import { Alert } from "@/components/ui/alert";
import { PlayerAvatar } from "@/components/ui/avatar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  SUPPORT_NOTE,
  TIME_CLASSES,
  TIME_CLASS_LABEL,
  type TimeClass,
} from "@/lib/chess/constants";
import { isValidChessUsername, normalizeChessUsername } from "@/lib/chess/username";
import { hasEnoughHistory } from "@/lib/rating-history";
import { formatDate, formatPercent, formatRelative } from "@/lib/utils";
import { getAppContext } from "@/server/auth";
import {
  getMatches,
  getPlayerByUsername,
  getPublicSettings,
  getTimeControls,
} from "@/server/data/public";

type Props = { params: Promise<{ username: string }> };

async function load(raw: string) {
  const username = normalizeChessUsername(decodeURIComponent(raw));
  if (!isValidChessUsername(username)) return null;
  return getPlayerByUsername(username);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const player = await load((await params).username);
  if (!player) return { title: "Player not found" };
  return {
    title: `${player.profile.display_name} (@${player.link.chess_username})`,
    description: `${player.profile.display_name}'s verified MNNIT chess profile: imported Chess.com ratings and college match record.`,
  };
}

export default async function PlayerPage({ params }: Props) {
  const player = await load((await params).username);
  if (!player) notFound();
  const { profile, link, ratings, stats, history } = player;

  const [ctx, matches, options, settings] = await Promise.all([
    getAppContext(),
    getMatches({ page: 1, pageSize: 10, username: link.chess_username }),
    getTimeControls(),
    getPublicSettings(),
  ]);
  const provisionalBelow =
    typeof settings.elo_provisional_games === "number" ? settings.elo_provisional_games : 10;
  const games = stats?.games_played ?? 0;
  const ability = !ctx
    ? "signed_out"
    : ctx.user.id === profile.id
      ? "self"
      : ctx.profile.is_approved
        ? "ok"
        : "not_approved";
  const ratingOf = (c: TimeClass) => ratings.find((r) => r.time_class === c);
  const historyFor = (c: TimeClass) =>
    history.filter((h) => h.time_class === c).map((h) => ({ t: h.observed_at, rating: h.rating }));
  const newest = ratings
    .map((r) => r.fetched_at)
    .sort()
    .at(-1);

  return (
    <div className="grid gap-10">
      <section className="grid gap-6 rounded-2xl border bg-card p-6 sm:p-8 md:grid-cols-[auto_1fr_auto] md:items-center">
        <PlayerAvatar
          name={profile.display_name}
          src={profile.avatar_url}
          className="size-20 text-xl"
        />
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-4xl leading-none tracking-tight">
              {profile.display_name}
            </h1>
            {profile.is_demo ? <DemoBadge /> : null}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <ExternalChessLink username={link.chess_username} />
            <PresenceDot userId={profile.id} />
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <CalendarDays className="size-3.5" aria-hidden /> Member since{" "}
              {formatDate(profile.created_at)}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <CollegeBadge verified />
            <VerifiedChessBadge verified />
          </div>
          {profile.bio ? (
            <p className="max-w-xl text-sm text-muted-foreground">{profile.bio}</p>
          ) : null}
        </div>
        <div>
          {profile.open_to_challenges || ability === "self" ? (
            <ChallengeButton
              recipientId={profile.id}
              recipientName={profile.display_name}
              options={options}
              ability={ability}
              size="md"
            />
          ) : (
            <span className="text-sm text-muted-foreground">Not taking challenges</span>
          )}
        </div>
      </section>

      <section className="grid gap-4">
        <SectionTitle>
          College record <span className="font-normal normal-case">(verified matches only)</span>
        </SectionTitle>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Games" value={games} />
          <Stat label="Wins" value={stats?.wins ?? 0} />
          <Stat label="Losses" value={stats?.losses ?? 0} />
          <Stat label="Draws" value={stats?.draws ?? 0} />
          <Stat
            label="Win rate"
            value={games ? formatPercent(Number(stats?.win_rate)) : "—"}
            hint={games ? `${stats?.wins} wins ÷ ${games} games` : "No verified games yet"}
          />
          <Stat
            label="College Elo"
            value={games ? Math.round(Number(stats?.elo)) : "—"}
            hint={
              games && games < provisionalBelow
                ? "Provisional (few games)"
                : games
                  ? "From college matches"
                  : undefined
            }
          />
        </dl>
        <p className="text-xs text-muted-foreground">
          Win rate = wins ÷ all verified games, draws included. Pending, disputed and unverified
          matches are excluded.
        </p>
      </section>

      <section className="grid gap-4">
        <SectionTitle>
          Chess.com ratings <span className="font-normal normal-case">(imported)</span>
        </SectionTitle>
        <Card>
          <CardContent className="p-0 sm:p-5">
            {ratings.length === 0 ? (
              <div className="p-5">
                <EmptyState icon={Info} title="No ratings imported yet">
                  Ratings are fetched in the background after verification and refreshed
                  periodically.
                </EmptyState>
              </div>
            ) : (
              <Table>
                <caption className="sr-only">Imported Chess.com ratings by category</caption>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Rating</TableHead>
                    <TableHead className="text-right">Best</TableHead>
                    <TableHead className="text-right">Chess.com record (W/L/D)</TableHead>
                    <TableHead>Refreshed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {TIME_CLASSES.map((c) => ratingOf(c))
                    .filter(Boolean)
                    .map((r) => (
                      <TableRow key={r!.time_class}>
                        <TableCell>
                          <TimeClassBadge timeClass={r!.time_class} />
                        </TableCell>
                        <TableCell className="text-right">
                          <RatingBadge rating={r!.rating} timeClass={r!.time_class} />
                        </TableCell>
                        <TableCell className="tabular text-right font-mono text-sm text-muted-foreground">
                          {r!.best_rating ?? "—"}
                        </TableCell>
                        <TableCell className="tabular text-right font-mono text-sm">
                          {r!.record_wins}/{r!.record_losses}/{r!.record_draws}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatRelative(r!.fetched_at)}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <p className="text-xs text-muted-foreground">
          {SUPPORT_NOTE} Source: Chess.com published-data API
          {newest ? `, last refreshed ${formatRelative(newest)}` : ""}.
        </p>
      </section>

      {TIME_CLASSES.some((c) => hasEnoughHistory(historyFor(c))) ? (
        <section className="grid gap-4 md:grid-cols-2">
          {TIME_CLASSES.map((c) => {
            const points = historyFor(c);
            // Only chart a category when there is enough history to say something true.
            return hasEnoughHistory(points) ? (
              <Card key={c}>
                <CardHeader>
                  <CardTitle>{TIME_CLASS_LABEL[c]} rating history</CardTitle>
                  <CardDescription>
                    Imported snapshots, recorded when the rating changed.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <RatingChart points={points} label={TIME_CLASS_LABEL[c]} />
                </CardContent>
              </Card>
            ) : null;
          })}
        </section>
      ) : null}

      <section className="grid gap-4">
        <SectionTitle>Recent college matches</SectionTitle>
        <Card>
          <CardContent className="p-0 sm:p-5">
            {matches.rows.length ? (
              <MatchesTable rows={matches.rows} perspective={link.chess_username} />
            ) : (
              <div className="p-5">
                <EmptyState icon={Info} title="No verified matches yet">
                  Challenge this player to play the first one.
                </EmptyState>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <Alert variant="info" title="How this profile is verified">
        Student eligibility was confirmed against the club’s approved list
        {link.verification_method === "admin_review"
          ? ", and Chess.com ownership by an administrator"
          : ", and Chess.com ownership by a one-time code on the public profile"}
        . Verified {formatDate(link.verified_at)}.
      </Alert>
    </div>
  );
}
