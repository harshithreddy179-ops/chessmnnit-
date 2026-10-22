import { AdminAction } from "@/components/admin/admin-action";
import { SectionTitle } from "@/components/data/primitives";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { can } from "@/lib/admin-ui";
import { getIntegrationStatus } from "@/lib/env.server";
import { formatDateTime, formatRelative } from "@/lib/utils";
import { requireAdmin } from "@/server/auth";
import { nameMap } from "@/server/data/admin";

export const metadata = { title: "Sync & jobs" };

const stateBadge = (s: string) => (
  <Badge variant={s === "ready" ? "success" : s === "partial" ? "warning" : "danger"}>
    {s === "ready" ? "configured" : s === "partial" ? "partly configured" : "not configured"}
  </Badge>
);

export default async function AdminSync() {
  const ctx = await requireAdmin();
  const db = ctx.supabase;
  const canAct = can(ctx.roles, ["verification_admin", "match_moderator"]);
  const status = getIntegrationStatus();
  const [errors, attempts, runs] = await Promise.all([
    db
      .from("chess_sync_state")
      .select("*")
      .gt("error_count", 0)
      .order("last_error_at", { ascending: false })
      .limit(30),
    db
      .from("match_sync_attempts")
      .select("*")
      .in("outcome", [
        "archive_unavailable",
        "rate_limited",
        "error",
        "gave_up",
        "ambiguous",
        "unknown_result",
      ])
      .order("id", { ascending: false })
      .limit(20),
    db.from("job_runs").select("*").order("id", { ascending: false }).limit(25),
  ]);
  const names = await nameMap(
    db,
    (errors.data ?? []).map((e) => e.user_id),
  );

  return (
    <div className="grid gap-10">
      <section className="grid gap-3">
        <SectionTitle>Integration status</SectionTitle>
        <Card>
          <CardContent className="grid gap-3 p-5 text-sm">
            <div className="grid gap-2 sm:grid-cols-2">
              <p className="flex items-center justify-between gap-3">
                <span>Supabase project (URL + publishable key)</span>
                {stateBadge(status.supabase)}
              </p>
              <p className="flex items-center justify-between gap-3">
                <span>Supabase secret key (server jobs)</span>
                {stateBadge(status.serviceRole)}
              </p>
              <p className="flex items-center justify-between gap-3">
                <span>Cron secret (scheduled endpoints)</span>
                {stateBadge(status.cron)}
              </p>
              <p className="flex items-center justify-between gap-3">
                <span>Chess.com contact email (User-Agent)</span>
                {stateBadge(status.chessApi.state)}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              Only whether each setting is present is shown, never its value.
            </p>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-3">
        <SectionTitle>Players whose Chess.com sync is failing</SectionTitle>
        {errors.data?.length ? (
          <Card>
            <CardContent className="p-0 sm:p-5">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Player</TableHead>
                    <TableHead>Error</TableHead>
                    <TableHead className="text-right">Failures</TableHead>
                    <TableHead>Next try</TableHead>
                    <TableHead className="text-right">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {errors.data.map((e) => (
                    <TableRow key={e.user_id}>
                      <TableCell>{names.get(e.user_id) ?? e.user_id.slice(0, 8)}</TableCell>
                      <TableCell className="text-sm">
                        {e.last_error}
                        {e.last_error === "player_id_changed" ||
                        e.last_error === "username_changed_at_chesscom" ? (
                          <Badge className="ml-2" variant="danger">
                            identity check needed
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="tabular text-right font-mono">
                        {e.error_count}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatRelative(e.next_sync_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        {canAct ? (
                          <AdminAction
                            label="Retry now"
                            needsReason={false}
                            payload={{ action: "retry_player_sync", user_id: e.user_id }}
                            success="Queued"
                          />
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ) : (
          <Alert variant="success">No player has a failing sync right now.</Alert>
        )}
      </section>

      <section className="grid gap-3">
        <SectionTitle>Recent result-sync problems</SectionTitle>
        {attempts.data?.length ? (
          <ul className="grid gap-2 text-sm">
            {attempts.data.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border bg-card px-3 py-2"
              >
                <span>
                  <Badge variant="warning">{a.outcome}</Badge>{" "}
                  <span className="ml-2 font-mono text-xs text-muted-foreground">
                    {a.challenge_id.slice(0, 8)}
                  </span>{" "}
                  {a.error ? <span className="text-danger"> {a.error}</span> : null}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(a.attempted_at)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing to report.</p>
        )}
        <p className="text-xs text-muted-foreground">
          Challenges stuck in review can be retried or resolved from the Matches tab.
        </p>
      </section>

      <section className="grid gap-3">
        <SectionTitle>Scheduled job history</SectionTitle>
        <Card>
          <CardContent className="p-0 sm:p-5">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Job</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.data?.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.job}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDateTime(r.started_at)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          r.status === "ok"
                            ? "success"
                            : r.status === "partial"
                              ? "warning"
                              : r.status === "running"
                                ? "info"
                                : "danger"
                        }
                      >
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-md truncate font-mono text-xs text-muted-foreground">
                      {r.error ?? JSON.stringify(r.stats)}
                    </TableCell>
                  </TableRow>
                ))}
                {runs.data?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-sm text-muted-foreground">
                      No job has run. Follow docs/DEPLOYMENT.md to schedule the cron endpoints.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
