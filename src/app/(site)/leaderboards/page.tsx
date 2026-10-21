import type { Metadata } from "next";
import Link from "next/link";
import { Trophy } from "lucide-react";
import { EmptyState, PageHeader, Pagination } from "@/components/data/primitives";
import { LeaderboardTable } from "@/components/data/leaderboard-table";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SUPPORT_NOTE, TIME_CLASSES, TIME_CLASS_LABEL } from "@/lib/chess/constants";
import { cn } from "@/lib/utils";
import { intParam, pick, qs, type RawSearchParams } from "@/lib/search-params";
import { getLeaderboard, getPublicSettings, LEADERBOARDS, type BoardId } from "@/server/data/public";

export const metadata: Metadata = {
  title: "Leaderboards",
  description: "MNNIT chess leaderboards: imported Chess.com ratings per category and college results from verified matches.",
};

const PAGE_SIZE = 25;

export default async function LeaderboardsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const sp = await searchParams;
  const ids = LEADERBOARDS.map((b) => b.id) as readonly BoardId[];
  const board = pick(sp.board, ids, "chesscom_rating");
  const timeClass = pick(sp.category, TIME_CLASSES, "rapid");
  const page = intParam(sp.page, 1, 1, 10_000);
  const def = LEADERBOARDS.find((b) => b.id === board)!;

  const [result, settings] = await Promise.all([getLeaderboard(board, timeClass, { page, pageSize: PAGE_SIZE }), getPublicSettings()]);
  const minGames = typeof settings.min_games_for_win_rate === "number" ? settings.min_games_for_win_rate : 5;
  const title = def.needsClass ? `${def.label} · ${TIME_CLASS_LABEL[timeClass]}` : def.label;

  return (
    <div className="grid gap-8">
      <PageHeader title="Leaderboards" description="Only students with verified eligibility and a verified Chess.com account are ranked. Ties are broken deterministically." />

      <nav aria-label="Leaderboards" className="scrollbar-thin -mx-1 flex gap-1 overflow-x-auto px-1">
        {LEADERBOARDS.map((b) => (
          <Link
            key={b.id}
            href={`/leaderboards${qs({ board: b.id, category: b.needsClass ? timeClass : undefined })}`}
            aria-current={b.id === board ? "page" : undefined}
            className={cn("rounded-full border px-3.5 py-1.5 text-sm whitespace-nowrap transition-colors", b.id === board ? "border-primary bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
          >
            {b.label}
          </Link>
        ))}
      </nav>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <h2 className="font-display text-3xl">{title}</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">{def.blurb}{board === "win_rate" ? ` Currently at least ${minGames} games.` : ""}</p>
        </div>
        {def.needsClass ? (
          <form method="get" className="flex items-end gap-2">
            <input type="hidden" name="board" value={board} />
            <div className="grid gap-1.5">
              <Label htmlFor="category">Rating category</Label>
              <NativeSelect id="category" name="category" defaultValue={timeClass} className="w-40">
                {TIME_CLASSES.map((c) => <option key={c} value={c}>{TIME_CLASS_LABEL[c]}</option>)}
              </NativeSelect>
            </div>
            <Button type="submit" variant="outline">Show</Button>
          </form>
        ) : null}
      </div>

      {!result.configured ? (
        <Alert variant="warning" title="Leaderboards are awaiting configuration">The database connection has not been set up for this deployment yet.</Alert>
      ) : result.error ? (
        <Alert variant="danger" title="The leaderboard could not be loaded">Please try again in a moment.</Alert>
      ) : result.rows.length === 0 ? (
        <EmptyState icon={Trophy} title="Nobody is ranked here yet">
          {def.needsClass ? `No verified player has a ${TIME_CLASS_LABEL[timeClass].toLowerCase()} rating imported yet.` : "This board fills in as verified college matches are recorded."}
        </EmptyState>
      ) : (
        <Card>
          <CardContent className="p-0 sm:p-5">
            <LeaderboardTable board={board} rows={result.rows} caption={title} />
          </CardContent>
        </Card>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={result.total} hrefFor={(p) => `/leaderboards${qs({ board, category: def.needsClass ? timeClass : undefined, page: p > 1 ? p : undefined })}`} />
      <p className="text-xs text-muted-foreground">{def.needsClass ? SUPPORT_NOTE : "College boards use only matches whose result was verified from Chess.com game data or confirmed by a moderator. Pending, disputed and unverified matches are excluded."} See <Link className="underline" href="/rules">scoring and rules</Link>.</p>
    </div>
  );
}
