import type { Metadata } from "next";
import Link from "next/link";
import { Search, Users } from "lucide-react";
import { DirectoryTable } from "@/components/data/directory-table";
import { EmptyState, PageHeader, Pagination } from "@/components/data/primitives";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { TIME_CLASSES, TIME_CLASS_LABEL } from "@/lib/chess/constants";
import { intParam, one, optionalInt, pick, qs, type RawSearchParams } from "@/lib/search-params";
import { getAppContext } from "@/server/auth";
import { getDirectory, getTimeControls } from "@/server/data/public";

export const metadata: Metadata = {
  title: "Players",
  description: "Verified MNNIT chess players: Chess.com ratings by category, college results and who is online.",
};

const SORTS = ["rating", "wins", "games", "recent", "name"] as const;
const PAGE_SIZE = 20;

export default async function PlayersPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const sp = await searchParams;
  const timeClass = pick(sp.category, TIME_CLASSES, "rapid");
  const sort = pick(sp.sort, SORTS, "rating");
  const page = intParam(sp.page, 1, 1, 10_000);
  const search = one(sp.q)?.slice(0, 60);
  const minRating = optionalInt(sp.min, 0, 4000);
  const maxRating = optionalInt(sp.max, 0, 4000);
  const preferred = TIME_CLASSES.includes(one(sp.prefers) as never) ? (one(sp.prefers) as (typeof TIME_CLASSES)[number]) : undefined;
  const openOnly = one(sp.open) === "1";

  const [ctx, directory, options] = await Promise.all([
    getAppContext(),
    getDirectory({ page, pageSize: PAGE_SIZE, search, timeClass, minRating, maxRating, preferred, openOnly, sort }),
    getTimeControls(),
  ]);

  const base = { q: search, category: timeClass, sort, min: minRating, max: maxRating, prefers: preferred, open: openOnly ? 1 : undefined };
  const filtered = Boolean(search || minRating !== undefined || maxRating !== undefined || preferred || openOnly);

  return (
    <div className="grid gap-8">
      <PageHeader title="Players" description="Verified MNNIT students. Ratings are imported from Chess.com for the category you choose; college results come only from verified matches." />

      <form method="get" className="grid gap-4 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-6" role="search" aria-label="Filter players">
        <div className="grid gap-1.5 lg:col-span-2">
          <Label htmlFor="q">Search</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input id="q" name="q" defaultValue={search} placeholder="Name or Chess.com username" className="pl-9" maxLength={60} />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="category">Rating category</Label>
          <NativeSelect id="category" name="category" defaultValue={timeClass}>
            {TIME_CLASSES.map((c) => <option key={c} value={c}>{TIME_CLASS_LABEL[c]}</option>)}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="min">Min rating</Label>
          <Input id="min" name="min" type="number" inputMode="numeric" min={0} max={4000} defaultValue={minRating} placeholder="1000" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="max">Max rating</Label>
          <Input id="max" name="max" type="number" inputMode="numeric" min={0} max={4000} defaultValue={maxRating} placeholder="2000" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="prefers">Prefers</Label>
          <NativeSelect id="prefers" name="prefers" defaultValue={preferred ?? ""}>
            <option value="">Any time control</option>
            {TIME_CLASSES.map((c) => <option key={c} value={c}>{TIME_CLASS_LABEL[c]}</option>)}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="sort">Sort by</Label>
          <NativeSelect id="sort" name="sort" defaultValue={sort}>
            <option value="rating">Rating (selected category)</option>
            <option value="wins">College wins</option>
            <option value="games">College games</option>
            <option value="recent">Recently active</option>
            <option value="name">Name</option>
          </NativeSelect>
        </div>
        <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-3">
          <Switch id="open" name="open" value="1" defaultChecked={openOnly} />
          <Label htmlFor="open">Only players accepting challenges</Label>
        </div>
        <div className="flex items-center justify-end gap-2 sm:col-span-2 lg:col-span-3">
          {filtered ? <Button asChild variant="ghost"><Link href="/players">Reset</Link></Button> : null}
          <Button type="submit">Apply filters</Button>
        </div>
      </form>

      {!directory.configured ? (
        <Alert variant="warning" title="Player directory is awaiting configuration">The database connection has not been set up for this deployment yet.</Alert>
      ) : directory.error ? (
        <Alert variant="danger" title="Players could not be loaded">Please try again in a moment.</Alert>
      ) : directory.rows.length === 0 ? (
        <EmptyState icon={Users} title={filtered ? "No players match those filters" : "No verified players yet"}
          action={filtered ? <Button asChild variant="outline"><Link href="/players">Clear filters</Link></Button> : undefined}>
          {filtered ? "Try widening the rating range or removing a filter." : "Players appear here after they verify their student status and Chess.com account."}
        </EmptyState>
      ) : (
        <>
          <DirectoryTable rows={directory.rows} timeClass={timeClass} viewerId={ctx?.user.id ?? null} viewerApproved={ctx?.profile.is_approved ?? false} options={options} />
          <Pagination page={page} pageSize={PAGE_SIZE} total={directory.total} hrefFor={(p) => `/players${qs({ ...base, page: p > 1 ? p : undefined })}`} />
        </>
      )}
    </div>
  );
}
