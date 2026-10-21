import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, Clock3, ExternalLink, Loader2, ShieldAlert } from "lucide-react";
import { ChallengeActions } from "@/components/forms/challenge-actions";
import { DisputeDialog } from "@/components/forms/dispute-dialog";
import { SectionTitle } from "@/components/data/primitives";
import { PresenceDot } from "@/components/realtime/presence";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { IN_PLAY_STATUSES, STATUS_INFO } from "@/lib/challenge-status";
import { chessProfileUrl } from "@/lib/chess/username";
import { uuid } from "@/lib/schemas";
import { formatDateTime, formatRelative } from "@/lib/utils";
import { requireOnboarded } from "@/server/auth";
import { getChallengeDetail } from "@/server/data/member";

export const metadata: Metadata = { title: "Challenge", robots: { index: false } };

const OUTCOME_TEXT: Record<string, string> = {
  no_game_found: "No finished game between you two yet",
  candidate_found: "Found a likely game; checking that nothing competes with it",
  settling: "Still the only candidate; waiting out the safety window",
  verified: "Result verified",
  ambiguous: "Several games matched; sent to a moderator",
  unknown_result: "Chess.com did not report a clear result; sent to a moderator",
  archive_unavailable: "Chess.com data was unavailable; will retry",
  rate_limited: "Chess.com asked us to slow down; will retry",
  error: "Something went wrong; sent to a moderator",
  gave_up: "No game found in time; sent to a moderator",
};

export default async function ChallengePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const ctx = await requireOnboarded(`/challenges/${id}`);
  const detail = await getChallengeDetail(ctx.supabase, ctx.user.id, id);
  if (!detail) notFound();
  const { challenge: c, events, attempts, match, disputes } = detail;
  const info = STATUS_INFO[c.status];
  const inPlay = IN_PLAY_STATUSES.includes(c.status);
  const myColour = match ? (match.white_user_id === ctx.user.id ? "white" : "black") : null;
  const outcome =
    match && match.result !== "draw"
      ? match.result === myColour
        ? "won"
        : "lost"
      : match
        ? "drew"
        : null;
  const openDispute = disputes.find((d) => d.status === "open");

  return (
    <div className="grid gap-8">
      <Link
        href="/challenges"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> All challenges
      </Link>

      <header className="grid gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-4xl leading-none sm:text-5xl">vs {c.opponentName}</h1>
          <Badge variant={info.variant}>{info.label}</Badge>
        </div>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <Link className="hover:underline" href={`/players/${c.opponentUsername}`}>
            @{c.opponentUsername}
          </Link>
          <PresenceDot userId={c.opponentId} />
          <span>
            {c.timeControlLabel} ({c.time_class})
          </span>
          <span>
            {c.direction === "sent" ? "You sent this" : "They sent this"}{" "}
            {formatRelative(c.created_at)}
          </span>
        </p>
        {c.message ? (
          <p className="max-w-xl rounded-lg border bg-card p-3 text-sm">“{c.message}”</p>
        ) : null}
        <p className="text-sm">{info.describe(c.direction)}</p>
        <ChallengeActions
          id={c.id}
          direction={c.direction}
          status={c.status}
          opponent={c.opponentName}
        />
        {c.status === "pending" ? (
          <p className="text-xs text-muted-foreground">Expires {formatDateTime(c.expires_at)}.</p>
        ) : null}
      </header>

      {inPlay && !match ? (
        <Card>
          <CardHeader>
            <CardTitle>How to play</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <ol className="grid list-decimal gap-2 pl-5">
              <li>
                Open{" "}
                <a
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                  href={chessProfileUrl(c.opponentUsername)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  @{c.opponentUsername} on Chess.com <ExternalLink className="size-3" aria-hidden />
                </a>{" "}
                and send them a challenge (or accept theirs).
              </li>
              <li>
                Use <strong>{c.timeControlLabel}</strong> standard chess. Rated or unrated both
                count.
              </li>
              <li>
                Play <strong>one game</strong>. If several games between you match, a moderator has
                to choose which one counts.
              </li>
              <li>
                That’s it. The result is detected automatically once Chess.com publishes the
                finished game.
              </li>
            </ol>
            <Alert variant="info">
              Accepting a challenge here does not create a game on Chess.com. We can’t send or
              accept Chess.com challenges for you.
            </Alert>
          </CardContent>
        </Card>
      ) : null}

      {match ? (
        <Card>
          <CardHeader>
            <CardTitle>Result</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <p className="flex items-center gap-2 text-lg font-medium">
              <CheckCircle2 className="size-5 text-success" aria-hidden />
              {outcome === "won" ? "You won" : outcome === "lost" ? "You lost" : "You drew"}
              <span className="tabular font-mono text-muted-foreground">
                ({match.result === "white" ? "1–0" : match.result === "black" ? "0–1" : "½–½"})
              </span>
              {match.status === "disputed" ? (
                <Badge variant="warning">Disputed — not counted</Badge>
              ) : null}
              {match.status === "voided" ? <Badge variant="neutral">Voided</Badge> : null}
            </p>
            <p className="text-sm text-muted-foreground">
              {match.source === "automatic"
                ? "Found automatically in the Chess.com archives."
                : "Confirmed by a moderator."}{" "}
              Finished {formatDateTime(match.ended_at)}.{" "}
              <a
                className="inline-flex items-center gap-1 text-primary hover:underline"
                href={match.game_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                View the game <ExternalLink className="size-3" aria-hidden />
              </a>
            </p>
          </CardContent>
        </Card>
      ) : null}

      {inPlay ? (
        <section className="grid gap-3" aria-labelledby="progress">
          <SectionTitle>
            <span id="progress">Result tracking</span>
          </SectionTitle>
          <Card>
            <CardContent className="grid gap-3 p-5 text-sm">
              <div className="flex flex-wrap gap-x-8 gap-y-2 text-muted-foreground">
                <span className="inline-flex items-center gap-2">
                  {c.status === "needs_review" ? (
                    <ShieldAlert className="size-4 text-danger" aria-hidden />
                  ) : (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  )}{" "}
                  {info.label}
                </span>
                <span>
                  Checks so far:{" "}
                  <strong className="tabular text-foreground">{c.check_count}</strong>
                </span>
                <span>
                  Last check:{" "}
                  <strong className="text-foreground">
                    {c.last_checked_at ? formatRelative(c.last_checked_at) : "not yet"}
                  </strong>
                </span>
                {c.next_check_at && c.status !== "needs_review" ? (
                  <span>
                    Next check:{" "}
                    <strong className="text-foreground">{formatRelative(c.next_check_at)}</strong>
                  </span>
                ) : null}
                {c.status === "checking_result" && c.settle_until ? (
                  <span>
                    Verifies after:{" "}
                    <strong className="text-foreground">{formatDateTime(c.settle_until)}</strong>
                  </span>
                ) : null}
              </div>
              {c.status === "needs_review" ? (
                <Alert variant="warning" title="A moderator will decide">
                  {c.review_reason ?? "The automatic check couldn’t decide on its own."} Both of you
                  have been notified.
                </Alert>
              ) : null}
              {attempts.length ? (
                <ul className="grid gap-1.5 border-t pt-3">
                  {attempts.slice(0, 6).map((a) => (
                    <li
                      key={a.id}
                      className="flex flex-wrap items-baseline justify-between gap-2 text-xs"
                    >
                      <span>{OUTCOME_TEXT[a.outcome] ?? a.outcome}</span>
                      <span className="text-muted-foreground">
                        {formatRelative(a.attempted_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="border-t pt-3 text-xs text-muted-foreground">
                  No checks yet. The first one runs a few minutes after acceptance.
                </p>
              )}
            </CardContent>
          </Card>
        </section>
      ) : null}

      {(inPlay || c.status === "result_verified") && !openDispute ? (
        <div className="flex flex-wrap items-center gap-3">
          <DisputeDialog
            challengeId={c.id}
            opponent={c.opponentName}
            verified={c.status === "result_verified"}
          />
          <span className="text-xs text-muted-foreground">
            Played the game but it isn’t showing, or the result looks wrong? Tell a moderator.
          </span>
        </div>
      ) : null}
      {openDispute ? (
        <Alert variant="info" title="A dispute is open">
          A moderator is reviewing it (“{openDispute.reason.slice(0, 120)}
          {openDispute.reason.length > 120 ? "…" : ""}”). The result doesn’t count until it’s
          resolved.
        </Alert>
      ) : null}

      <section className="grid gap-3" aria-labelledby="timeline">
        <SectionTitle>
          <span id="timeline">Timeline</span>
        </SectionTitle>
        <ol className="grid gap-3 border-l pl-5">
          {events.map((e) => (
            <li key={e.id} className="relative text-sm">
              <span
                aria-hidden
                className="absolute top-1.5 -left-[1.6rem] size-2.5 rounded-full border bg-background"
              />
              <span className="font-medium">{STATUS_INFO[e.to_status].label}</span>
              <span className="ml-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Clock3 className="size-3" aria-hidden /> {formatDateTime(e.created_at)}
                {e.actor_id
                  ? e.actor_id === ctx.user.id
                    ? " · you"
                    : " · opponent or moderator"
                  : " · automatic"}
              </span>
              {e.detail ? <p className="text-xs text-muted-foreground">{e.detail}</p> : null}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
