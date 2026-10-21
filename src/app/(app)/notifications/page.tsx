import type { Metadata } from "next";
import Link from "next/link";
import { Bell } from "lucide-react";
import { EmptyState, PageHeader, Pagination } from "@/components/data/primitives";
import { MarkAllRead } from "@/components/forms/mark-read-button";
import { notificationHref } from "@/components/realtime/notifications";
import { intParam, type RawSearchParams } from "@/lib/search-params";
import { cn, formatRelative } from "@/lib/utils";
import { requireOnboarded } from "@/server/auth";
import { getNotifications } from "@/server/data/member";

export const metadata: Metadata = { title: "Notifications", robots: { index: false } };
const PAGE_SIZE = 20;

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const ctx = await requireOnboarded("/notifications");
  const page = intParam((await searchParams).page, 1, 1, 1000);
  const { rows, total } = await getNotifications(ctx.supabase, ctx.user.id, page, PAGE_SIZE);
  const unread = rows.filter((n) => !n.read_at).length;
  return (
    <div className="grid gap-8">
      <PageHeader title="Notifications" description="Challenges, results and verification decisions. These are in-app only; no email or push notifications are sent." actions={<MarkAllRead disabled={unread === 0} />} />
      {rows.length === 0 ? (
        <EmptyState icon={Bell} title="You’re all caught up">New challenges and verified results will appear here the moment they happen.</EmptyState>
      ) : (
        <ul className="grid gap-2">
          {rows.map((n) => (
            <li key={n.id}>
              <Link href={notificationHref({ data: n.data as Record<string, unknown>, type: n.type })} className={cn("flex items-start gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-muted/50", !n.read_at && "border-primary/40")}>
                <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-primary")} />
                <span className="grid gap-0.5">
                  <span className="text-sm font-medium">{n.title}{!n.read_at ? <span className="sr-only"> (unread)</span> : null}</span>
                  {n.body ? <span className="text-sm text-muted-foreground">{n.body}</span> : null}
                  <span className="text-xs text-muted-foreground">{formatRelative(n.created_at)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} hrefFor={(p) => `/notifications${p > 1 ? `?page=${p}` : ""}`} />
    </div>
  );
}
