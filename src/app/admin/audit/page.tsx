import { Pagination } from "@/components/data/primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { intParam, one, qs, type RawSearchParams } from "@/lib/search-params";
import { formatDateTime } from "@/lib/utils";
import { requireAdmin } from "@/server/auth";
import { nameMap } from "@/server/data/admin";

export const metadata = { title: "Audit log" };
const PAGE_SIZE = 40;

export default async function AdminAudit({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const ctx = await requireAdmin();
  const sp = await searchParams;
  const page = intParam(sp.page, 1, 1, 10_000);
  const action = one(sp.action)?.trim().slice(0, 60).replace(/[^a-z0-9._]/gi, "");
  let q = ctx.supabase.from("audit_logs").select("*", { count: "exact" }).order("id", { ascending: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (action) q = q.ilike("action", `${action}%`);
  const { data, count } = await q;
  const names = await nameMap(ctx.supabase, [...(data ?? []).map((r) => r.actor_id ?? ""), ...(data ?? []).filter((r) => r.target_type === "profile").map((r) => r.target_id ?? "")]);
  return (
    <div className="grid gap-6">
      <p className="text-sm text-muted-foreground">Append-only. Every sensitive action records who did it, what it affected, when, and why. Entries cannot be edited or deleted.</p>
      <form method="get" className="flex flex-wrap items-end gap-3" role="search">
        <div className="grid gap-1.5"><Label htmlFor="action">Action starts with</Label><Input id="action" name="action" defaultValue={action} placeholder="e.g. match. or chess_link." className="w-64" /></div>
        <Button type="submit" variant="outline">Filter</Button>
      </form>
      <Card><CardContent className="grid gap-0 p-0">
        {data?.map((r) => (
          <div key={r.id} className="grid gap-1 border-b px-4 py-3 text-sm last:border-0 sm:grid-cols-[11rem_1fr] sm:gap-4">
            <span className="text-xs text-muted-foreground">{formatDateTime(r.created_at)}</span>
            <span className="grid gap-0.5">
              <span className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs font-semibold">{r.action}</span><Badge variant={r.actor_kind === "admin" ? "info" : "neutral"}>{r.actor_kind}</Badge></span>
              <span className="text-muted-foreground">by {r.actor_id ? (names.get(r.actor_id) ?? r.actor_id.slice(0, 8)) : "system"} · {r.target_type}{r.target_id ? ` ${names.get(r.target_id) ?? r.target_id.slice(0, 12)}` : ""}</span>
              {r.reason ? <span>“{r.reason}”</span> : null}
            </span>
          </div>
        ))}
        {data?.length === 0 ? <p className="p-5 text-sm text-muted-foreground">No entries.</p> : null}
      </CardContent></Card>
      <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} hrefFor={(p) => `/admin/audit${qs({ action, page: p > 1 ? p : undefined })}`} />
    </div>
  );
}
