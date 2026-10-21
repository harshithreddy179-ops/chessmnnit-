import { Stat } from "@/components/data/primitives";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { STATUS_INFO, type ChallengeStatus } from "@/lib/challenge-status";
import { formatRelative } from "@/lib/utils";
import { requireAdmin } from "@/server/auth";
import { getOverview } from "@/server/data/admin";

export const metadata = { title: "Overview" };

export default async function AdminOverview() {
  const ctx = await requireAdmin();
  const o = await getOverview(ctx.supabase);
  return (
    <div className="grid gap-8">
      <section className="grid gap-3">
        <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
          Players
        </h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Accounts" value={o.players.accounts} />
          <Stat label="Eligible" value={o.players.eligible} />
          <Stat label="Chess.com verified" value={o.players.chess_verified} />
          <Stat label="Approved (public)" value={o.players.approved} />
          <Stat label="Suspended" value={o.players.suspended} />
          <Stat label="New, 7 days" value={o.players.new_7d} />
        </dl>
      </section>
      <section className="grid gap-3">
        <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
          Waiting for a human
        </h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="Claims to review" value={o.queues.claims_needing_review} />
          <Stat label="Eligibility requests" value={o.queues.eligibility_requests} />
          <Stat label="Recovery requests" value={o.queues.recovery_requests} />
          <Stat label="Matches to resolve" value={o.queues.challenges_needing_review} />
          <Stat label="Open disputes" value={o.queues.open_disputes} />
        </dl>
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Challenge activity</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              {o.challenges.created_7d} created in the last 7 days.
            </p>
            <ul className="flex flex-wrap gap-2">
              {Object.entries(o.challenges.by_status).map(([s, n]) => (
                <li key={s}>
                  <Badge variant={STATUS_INFO[s as ChallengeStatus]?.variant ?? "neutral"}>
                    {STATUS_INFO[s as ChallengeStatus]?.label ?? s}: {n}
                  </Badge>
                </li>
              ))}
              {Object.keys(o.challenges.by_status).length === 0 ? (
                <li className="text-sm text-muted-foreground">No challenges yet.</li>
              ) : null}
            </ul>
            <dl className="grid grid-cols-3 gap-3 pt-2">
              <Stat label="Verified matches" value={o.matches.verified_total} />
              <Stat label="Last 7 days" value={o.matches.verified_7d} />
              <Stat label="Disputed" value={o.matches.disputed} />
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Synchronisation</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <dl className="grid grid-cols-2 gap-3">
              <Stat label="Players with sync errors" value={o.sync.players_with_errors} />
              <Stat label="Never synced" value={o.sync.players_never_synced} />
            </dl>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Job</TableHead>
                  <TableHead>Last run</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {o.sync.last_runs.map((j) => (
                  <TableRow key={j.job}>
                    <TableCell className="font-mono text-xs">{j.job}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatRelative(j.started_at)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          j.status === "ok"
                            ? "success"
                            : j.status === "partial"
                              ? "warning"
                              : j.status === "running"
                                ? "info"
                                : "danger"
                        }
                      >
                        {j.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {o.sync.last_runs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-sm text-muted-foreground">
                      No scheduled job has run yet. Check the cron configuration.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
