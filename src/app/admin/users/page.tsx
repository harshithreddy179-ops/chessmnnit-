import Link from "next/link";
import { CollegeBadge, VerifiedChessBadge } from "@/components/chess/badges";
import { EmptyState, Pagination } from "@/components/data/primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { intParam, one, pick, qs, type RawSearchParams } from "@/lib/search-params";
import { formatDate } from "@/lib/utils";
import { requireAdmin } from "@/server/auth";
import { Users } from "lucide-react";

export const metadata = { title: "Users" };
const PAGE_SIZE = 25;
const FILTERS = ["all", "approved", "needs_eligibility", "needs_chess", "suspended"] as const;

export default async function AdminUsers({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const ctx = await requireAdmin();
  const sp = await searchParams;
  const page = intParam(sp.page, 1, 1, 10_000);
  const filter = pick(sp.filter, FILTERS, "all");
  const search = one(sp.q)?.trim().slice(0, 60);

  let query = ctx.supabase
    .from("profiles")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (search)
    query = query.ilike("display_name", `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  if (filter === "approved") query = query.eq("is_approved", true);
  if (filter === "needs_eligibility") query = query.neq("eligibility_status", "verified");
  if (filter === "suspended") query = query.eq("account_status", "suspended");
  const { data: profiles, count } = await query;
  const rows = profiles ?? [];
  const { data: links } = rows.length
    ? await ctx.supabase
        .from("chess_account_links")
        .select("user_id,chess_username,verification_method")
        .in(
          "user_id",
          rows.map((r) => r.id),
        )
    : { data: [] };
  const linkOf = new Map((links ?? []).map((l) => [l.user_id, l]));
  const shown = filter === "needs_chess" ? rows.filter((r) => !linkOf.has(r.id)) : rows;

  return (
    <div className="grid gap-6">
      <form
        method="get"
        className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-[1fr_14rem_auto] sm:items-end"
        role="search"
      >
        <div className="grid gap-1.5">
          <Label htmlFor="q">Search by display name</Label>
          <Input id="q" name="q" defaultValue={search} maxLength={60} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="filter">Show</Label>
          <NativeSelect id="filter" name="filter" defaultValue={filter}>
            <option value="all">Everyone</option>
            <option value="approved">Approved (public)</option>
            <option value="needs_eligibility">Eligibility not verified</option>
            <option value="needs_chess">No verified Chess.com link</option>
            <option value="suspended">Suspended</option>
          </NativeSelect>
        </div>
        <Button type="submit">Apply</Button>
      </form>
      {shown.length === 0 ? (
        <EmptyState icon={Users} title="No users match">
          Try a different filter.
        </EmptyState>
      ) : (
        <Card>
          <CardContent className="p-0 sm:p-5">
            <Table>
              <caption className="sr-only">Registered users</caption>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>User</TableHead>
                  <TableHead>College</TableHead>
                  <TableHead>Chess.com</TableHead>
                  <TableHead>Profile</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((p) => {
                  const l = linkOf.get(p.id);
                  return (
                    <TableRow key={p.id}>
                      <TableCell>
                        <Link href={`/admin/users/${p.id}`} className="font-medium hover:underline">
                          {p.display_name}
                        </Link>
                        {p.is_demo ? (
                          <Badge className="ml-2" variant="warning">
                            demo
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <CollegeBadge verified={p.eligibility_status === "verified"} />
                        {p.eligibility_status === "revoked" ? (
                          <Badge className="ml-1" variant="danger">
                            revoked
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {l ? (
                          <span className="flex items-center gap-2">
                            <span className="font-mono text-xs">@{l.chess_username}</span>
                            <VerifiedChessBadge verified />
                          </span>
                        ) : (
                          <VerifiedChessBadge verified={false} />
                        )}
                      </TableCell>
                      <TableCell>
                        {p.onboarding_completed_at ? (
                          <Badge variant="success">Complete</Badge>
                        ) : (
                          <Badge variant="neutral">Incomplete</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {p.account_status === "suspended" ? (
                          <Badge variant="danger">Suspended</Badge>
                        ) : p.is_approved ? (
                          <Badge variant="success">Public</Badge>
                        ) : (
                          <Badge variant="neutral">Hidden</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap text-muted-foreground">
                        {formatDate(p.created_at)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={count ?? 0}
        hrefFor={(p) =>
          `/admin/users${qs({ q: search, filter: filter === "all" ? undefined : filter, page: p > 1 ? p : undefined })}`
        }
      />
    </div>
  );
}
