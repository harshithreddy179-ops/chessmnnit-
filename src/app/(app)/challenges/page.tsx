import type { Metadata } from "next";
import Link from "next/link";
import { Inbox, Send, Swords, History } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/data/primitives";
import { ChallengeActions } from "@/components/forms/challenge-actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { STATUS_INFO } from "@/lib/challenge-status";
import { pick, qs, type RawSearchParams } from "@/lib/search-params";
import { cn, formatRelative } from "@/lib/utils";
import { requireOnboarded } from "@/server/auth";
import { getMyChallenges, isActiveStatus, type ChallengeView } from "@/server/data/member";

export const metadata: Metadata = { title: "Challenges", robots: { index: false } };

const TABS = [
  {
    id: "incoming",
    label: "Incoming",
    icon: Inbox,
    test: (c: ChallengeView) => c.status === "pending" && c.direction === "received",
  },
  {
    id: "sent",
    label: "Sent",
    icon: Send,
    test: (c: ChallengeView) => c.status === "pending" && c.direction === "sent",
  },
  {
    id: "active",
    label: "In play",
    icon: Swords,
    test: (c: ChallengeView) => isActiveStatus(c.status) && c.status !== "pending",
  },
  {
    id: "history",
    label: "History",
    icon: History,
    test: (c: ChallengeView) => !isActiveStatus(c.status),
  },
] as const;

export default async function ChallengesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const ctx = await requireOnboarded("/challenges");
  const all = await getMyChallenges(ctx.supabase, ctx.user.id, 200);
  const sp = await searchParams;
  const incomingCount = all.filter(TABS[0].test).length;
  const tab = pick(
    sp.tab,
    ["incoming", "sent", "active", "history"] as const,
    incomingCount ? "incoming" : all.some(TABS[2].test) ? "active" : "incoming",
  );
  const current = TABS.find((t) => t.id === tab)!;
  const rows = all.filter(current.test);

  return (
    <div className="grid gap-8">
      <PageHeader
        title="Challenges"
        description="Accepting a challenge doesn’t create a Chess.com game. You and your opponent play on Chess.com, and we find and verify the result."
        actions={
          <Link className="text-sm text-primary hover:underline" href="/players">
            Find someone to challenge →
          </Link>
        }
      />
      <nav
        aria-label="Challenge lists"
        className="flex scrollbar-thin gap-1 overflow-x-auto border-b"
      >
        {TABS.map((t) => {
          const n = all.filter(t.test).length;
          return (
            <Link
              key={t.id}
              href={`/challenges${qs({ tab: t.id })}`}
              aria-current={t.id === tab ? "page" : undefined}
              className={cn(
                "-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap",
                t.id === tab
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <t.icon className="size-4" aria-hidden /> {t.label}
              {n > 0 && t.id !== "history" ? (
                <span className="tabular rounded-full bg-muted px-1.5 text-xs">{n}</span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      {rows.length === 0 ? (
        <EmptyState icon={current.icon} title={`Nothing in ${current.label.toLowerCase()}`}>
          {tab === "incoming"
            ? "When someone challenges you it shows up here, and you’ll get a live notification."
            : tab === "sent"
              ? "Challenges you’ve sent that haven’t been answered appear here."
              : tab === "active"
                ? "Accepted challenges waiting for a result appear here."
                : "Finished, declined, cancelled and expired challenges appear here."}
        </EmptyState>
      ) : (
        <ul className="grid gap-3">
          {rows.map((c) => {
            const info = STATUS_INFO[c.status];
            return (
              <li key={c.id}>
                <Card>
                  <CardContent className="grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
                    <div className="grid gap-1">
                      <Link href={`/challenges/${c.id}`} className="font-medium hover:underline">
                        {c.direction === "sent" ? "You challenged" : "Challenged by"}{" "}
                        {c.opponentName}{" "}
                        <span className="font-normal text-muted-foreground">
                          @{c.opponentUsername}
                        </span>
                      </Link>
                      <p className="text-sm text-muted-foreground">
                        {c.timeControlLabel} · {formatRelative(c.created_at)}
                        {c.message ? ` · “${c.message}”` : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">{info.describe(c.direction)}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                      <Badge variant={info.variant}>{info.label}</Badge>
                      <ChallengeActions
                        id={c.id}
                        direction={c.direction}
                        status={c.status}
                        opponent={c.opponentName}
                      />
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
