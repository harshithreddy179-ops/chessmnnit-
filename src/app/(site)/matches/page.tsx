import type { Metadata } from "next";
import Link from "next/link";
import { Swords } from "lucide-react";
import { EmptyState, PageHeader, Pagination } from "@/components/data/primitives";
import { MatchesTable } from "@/components/data/matches-table";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { TIME_CLASSES, TIME_CLASS_LABEL } from "@/lib/chess/constants";
import { parseChessUsername } from "@/lib/chess/username";
import { intParam, one, pick, qs, type RawSearchParams } from "@/lib/search-params";
import { getMatches } from "@/server/data/public";

export const metadata: Metadata = {
  title: "Match history",
  description: "Verified MNNIT college chess matches with links to the games on Chess.com.",
};

const PAGE_SIZE = 20;

export default async function MatchesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const sp = await searchParams;
  const page = intParam(sp.page, 1, 1, 10_000);
  const timeClass = TIME_CLASSES.includes(one(sp.category) as never)
    ? (one(sp.category) as (typeof TIME_CLASSES)[number])
    : undefined;
  const player = one(sp.player) ? (parseChessUsername(one(sp.player)!) ?? undefined) : undefined;
  const outcome = player
    ? pick(sp.outcome, ["win", "loss", "draw", ""] as const, "") || undefined
    : undefined;
  const result = await getMatches({
    page,
    pageSize: PAGE_SIZE,
    timeClass,
    username: player,
    outcome,
  });
  const filtered = Boolean(timeClass || player);

  return (
    <div className="grid gap-8">
      <PageHeader
        title="Match history"
        description="Every verified college match. Each links to the actual game on Chess.com."
      />
      <form
        method="get"
        className="grid gap-4 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4"
        role="search"
        aria-label="Filter matches"
      >
        <div className="grid gap-1.5">
          <Label htmlFor="player">Player (Chess.com username)</Label>
          <Input
            id="player"
            name="player"
            defaultValue={player}
            placeholder="e.g. magnus_c"
            maxLength={60}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="outcome">Outcome for that player</Label>
          <NativeSelect id="outcome" name="outcome" defaultValue={outcome ?? ""}>
            <option value="">Any</option>
            <option value="win">Wins</option>
            <option value="loss">Losses</option>
            <option value="draw">Draws</option>
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="category">Time control</Label>
          <NativeSelect id="category" name="category" defaultValue={timeClass ?? ""}>
            <option value="">All</option>
            {TIME_CLASSES.map((c) => (
              <option key={c} value={c}>
                {TIME_CLASS_LABEL[c]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex items-end justify-end gap-2">
          {filtered ? (
            <Button asChild variant="ghost">
              <Link href="/matches">Reset</Link>
            </Button>
          ) : null}
          <Button type="submit">Apply</Button>
        </div>
      </form>

      {!result.configured ? (
        <Alert variant="warning" title="Match history is awaiting configuration">
          The database connection has not been set up for this deployment yet.
        </Alert>
      ) : result.error ? (
        <Alert variant="danger" title="Matches could not be loaded">
          Please try again in a moment.
        </Alert>
      ) : result.rows.length === 0 ? (
        <EmptyState
          icon={Swords}
          title={filtered ? "No matches for that filter" : "No verified matches yet"}
        >
          {filtered
            ? "Try a different player or time control."
            : "Matches appear here after both players' game is found and verified."}
        </EmptyState>
      ) : (
        <Card>
          <CardContent className="p-0 sm:p-5">
            <MatchesTable rows={result.rows} perspective={player} />
          </CardContent>
        </Card>
      )}
      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={result.total}
        hrefFor={(p) =>
          `/matches${qs({ category: timeClass, player, outcome, page: p > 1 ? p : undefined })}`
        }
      />
    </div>
  );
}
