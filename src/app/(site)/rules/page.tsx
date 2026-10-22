import type { Metadata } from "next";
import { PageHeader } from "@/components/data/primitives";
import { getPublicSettings } from "@/server/data/public";

export const metadata: Metadata = {
  title: "Scoring & rules",
  description:
    "How MNNIT Chess verifies players, records results and computes points, win rate and college Elo.",
};

const num = (v: unknown, d: number) => (typeof v === "number" ? v : d);

export default async function RulesPage() {
  const s = await getPublicSettings();
  const win = num(s.points_per_win, 3);
  const draw = num(s.points_per_draw, 1);
  const k = num(s.elo_k_factor, 32);
  const start = num(s.elo_initial_rating, 1000);
  const minGames = num(s.min_games_for_win_rate, 5);
  const provisional = num(s.elo_provisional_games, 10);
  const settle = num(s.match_settle_minutes, 60);
  const wait = num(s.match_max_wait_hours, 72);
  const expiry = num(s.challenge_expiry_hours, 48);

  return (
    <div className="grid gap-10">
      <PageHeader
        title="Scoring & rules"
        description="Exactly how results are verified and how every number on the leaderboards is calculated. The values below are the live settings."
      />
      <div className="prose-rules grid max-w-3xl gap-10 text-sm leading-relaxed text-muted-foreground [&_h2]:mb-2 [&_h2]:font-display [&_h2]:text-3xl [&_h2]:text-foreground [&_strong]:text-foreground [&_ul]:grid [&_ul]:list-disc [&_ul]:gap-1.5 [&_ul]:pl-5">
        <section>
          <h2>Who appears</h2>
          <ul>
            <li>
              Members who have signed in with Google, added their Chess.com username and finished
              onboarding.
            </li>
            <li>
              A Chess.com username belongs to <strong>one</strong> member and a member has{" "}
              <strong>one</strong> Chess.com account. Members type their own username; the club does
              not prove who owns a Chess.com account, and administrators can correct a wrong link.
            </li>
            <li>
              Suspended players and players who have not finished onboarding are hidden everywhere.
            </li>
          </ul>
        </section>
        <section>
          <h2>Imported Chess.com ratings</h2>
          <p>
            Ratings come from Chess.com’s public statistics and are labelled with the date they were
            last refreshed. Bullet, Blitz, Rapid and Daily are separate ratings and are{" "}
            <strong>never combined</strong>. They are not earned exclusively against MNNIT students
            and are kept apart from college statistics.
          </p>
        </section>
        <section>
          <h2>How a college match is recorded</h2>
          <ul>
            <li>
              A challenge expires if unanswered for <strong>{expiry} hours</strong>. Accepting it
              does not create a game; both players play on Chess.com themselves.
            </li>
            <li>
              A background job reads both players’ Chess.com archives and looks for a finished
              standard-chess game between exactly those two players that ended after acceptance,
              with the agreed time control.
            </li>
            <li>
              It never assumes the first game found is the right one. If{" "}
              <strong>more than one</strong> game qualifies, or the result is unclear, the challenge
              goes to <strong>moderator review</strong>.
            </li>
            <li>
              A single candidate must stay the only candidate for <strong>{settle} minutes</strong>{" "}
              (archives can lag) before it is verified.
            </li>
            <li>
              If nothing is found within <strong>{wait} hours</strong>, a moderator decides. Players
              can also open a dispute at any time; a disputed match stops counting until it is ruled
              on.
            </li>
            <li>
              One Chess.com game can be attached to at most one match, and one challenge produces at
              most one match.
            </li>
          </ul>
        </section>
        <section>
          <h2>Statistics</h2>
          <ul>
            <li>
              <strong>Games played</strong> = verified college matches.
            </li>
            <li>
              <strong>Points</strong>: win = {win}, draw = {draw}, loss = 0.
            </li>
            <li>
              <strong>Win rate</strong> = wins ÷ games played (draws count as games, so a draw does
              not raise the rate). The win-rate board requires at least <strong>{minGames}</strong>{" "}
              games and shows the sample size.
            </li>
            <li>
              <strong>College Elo</strong>: everyone starts at {start}. Matches are replayed in the
              order they finished with the standard expected-score formula and K = {k}. Players with
              fewer than {provisional} games are marked provisional. It reflects college matches
              only.
            </li>
            <li>
              <strong>Ties</strong> are broken the same way every time: each board lists its
              tie-breakers (for example wins → fewer losses → fewer games), then Chess.com username.
            </li>
          </ul>
        </section>
        <section>
          <h2>Presence</h2>
          <p>
            “Available”, “busy” and “offline” are live and not stored. You can set yourself to{" "}
            <strong>invisible</strong> at any time and others will see you as offline.
          </p>
        </section>
      </div>
    </div>
  );
}
