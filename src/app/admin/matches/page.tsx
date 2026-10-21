import { ExternalLink, Flag, Swords } from "lucide-react";
import { AdminAction } from "@/components/admin/admin-action";
import { ResolveMatch } from "@/components/admin/resolve-match";
import { EmptyState, SectionTitle } from "@/components/data/primitives";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { can } from "@/lib/admin-ui";
import { STATUS_INFO } from "@/lib/challenge-status";
import { formatDateTime, formatRelative } from "@/lib/utils";
import { requireAdmin } from "@/server/auth";
import { nameMap } from "@/server/data/admin";

export const metadata = { title: "Matches" };

export default async function AdminMatches() {
  const ctx = await requireAdmin(["match_moderator"]);
  const db = ctx.supabase;
  const canAct = can(ctx.roles, ["match_moderator"]);
  const [review, disputes, recent] = await Promise.all([
    db
      .from("challenges")
      .select("*")
      .eq("status", "needs_review")
      .order("status_changed_at")
      .limit(50),
    db.from("match_disputes").select("*").eq("status", "open").order("created_at").limit(50),
    db
      .from("college_matches")
      .select("*")
      .in("status", ["verified", "disputed"])
      .order("ended_at", { ascending: false })
      .limit(20),
  ]);
  const games = new Map<
    string,
    {
      id: string;
      game_url: string;
      winner: string;
      time_control: string | null;
      ended_at: string;
      white_username: string;
      black_username: string;
    }[]
  >();
  for (const c of review.data ?? []) {
    const { data } = await db
      .from("imported_chess_games")
      .select("id,game_url,winner,time_control,ended_at,white_username,black_username")
      .or(
        `and(white_username.eq.${c.challenger_username},black_username.eq.${c.recipient_username}),and(white_username.eq.${c.recipient_username},black_username.eq.${c.challenger_username})`,
      )
      .gte("ended_at", c.accepted_at ?? c.created_at)
      .order("ended_at");
    games.set(c.id, data ?? []);
  }
  const disputeChallenges = disputes.data?.length
    ? await db
        .from("challenges")
        .select("id,challenger_username,recipient_username,status")
        .in(
          "id",
          disputes.data.map((d) => d.challenge_id),
        )
    : { data: [] };
  const names = await nameMap(
    db,
    (disputes.data ?? []).map((d) => d.opened_by),
  );

  return (
    <div className="grid gap-10">
      {!canAct ? (
        <Alert variant="info">
          You can view these queues, but only match moderators can resolve them.
        </Alert>
      ) : null}

      <section className="grid gap-3">
        <SectionTitle>Challenges needing a moderator</SectionTitle>
        {review.data?.length ? (
          review.data.map((c) => (
            <Card key={c.id}>
              <CardContent className="grid gap-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">
                    <span className="font-mono">@{c.challenger_username}</span> vs{" "}
                    <span className="font-mono">@{c.recipient_username}</span>{" "}
                    <span className="font-normal text-muted-foreground">
                      · {c.time_control} · accepted {formatRelative(c.accepted_at)}
                    </span>
                  </p>
                  <Badge variant={STATUS_INFO[c.status].variant}>
                    {STATUS_INFO[c.status].label}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">Why: {c.review_reason ?? "—"}</p>
                <div className="grid gap-1">
                  <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Games between them since acceptance (from Chess.com archives)
                  </p>
                  {games.get(c.id)?.length ? (
                    <ul className="grid gap-1 text-sm">
                      {games.get(c.id)!.map((g) => (
                        <li key={g.id} className="flex flex-wrap items-center gap-3">
                          <a
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                            href={g.game_url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {g.game_url.replace("https://www.chess.com/", "")}{" "}
                            <ExternalLink className="size-3" aria-hidden />
                          </a>
                          <span className="text-muted-foreground">
                            {formatDateTime(g.ended_at)} · {g.time_control ?? "?"} ·{" "}
                            {g.winner === "unknown"
                              ? "result unknown"
                              : g.winner === "draw"
                                ? "draw"
                                : `${g.winner} won`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">None found.</p>
                  )}
                </div>
                {canAct ? (
                  <ResolveMatch
                    challengeId={c.id}
                    challengerName={`@${c.challenger_username}`}
                    recipientName={`@${c.recipient_username}`}
                  />
                ) : null}
              </CardContent>
            </Card>
          ))
        ) : (
          <EmptyState icon={Swords} title="Nothing needs review">
            Ambiguous or stuck challenges appear here.
          </EmptyState>
        )}
      </section>

      <section className="grid gap-3">
        <SectionTitle>Open disputes</SectionTitle>
        {disputes.data?.length ? (
          disputes.data.map((d) => {
            const ch = disputeChallenges.data?.find((c) => c.id === d.challenge_id);
            return (
              <Card key={d.id}>
                <CardContent className="grid gap-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="font-medium">
                      {names.get(d.opened_by) ?? "A player"} disputes{" "}
                      {ch ? (
                        <span className="font-mono">
                          @{ch.challenger_username} vs @{ch.recipient_username}
                        </span>
                      ) : (
                        "a match"
                      )}{" "}
                      <span className="font-normal text-muted-foreground">
                        · {formatRelative(d.created_at)}
                      </span>
                    </p>
                    {canAct ? (
                      <div className="flex gap-2">
                        <AdminAction
                          label="Mark resolved"
                          variant="default"
                          title="Close this dispute"
                          description="Use the match tools to correct or void the result first if needed. Closing releases any match still on hold."
                          payload={{
                            action: "resolve_dispute",
                            dispute_id: d.id,
                            status: "resolved",
                          }}
                          reasonKey="note"
                          reasonLabel="Ruling (shown to the player)"
                          success="Dispute resolved"
                        />
                        <AdminAction
                          label="Reject"
                          payload={{
                            action: "resolve_dispute",
                            dispute_id: d.id,
                            status: "rejected",
                          }}
                          reasonKey="note"
                          reasonLabel="Why it was rejected"
                          title="Reject this dispute"
                          success="Dispute rejected"
                        />
                      </div>
                    ) : null}
                  </div>
                  <p className="rounded-md bg-muted p-3 text-sm">{d.reason}</p>
                  <p className="text-xs text-muted-foreground">
                    {d.proposed_game_url ? (
                      <>
                        Proposed game:{" "}
                        <a
                          className="underline"
                          href={d.proposed_game_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {d.proposed_game_url}
                        </a>{" "}
                        ·{" "}
                      </>
                    ) : null}
                    {d.proposed_result
                      ? `They say: ${d.proposed_result} won/drew`
                      : "No result proposed"}
                  </p>
                </CardContent>
              </Card>
            );
          })
        ) : (
          <EmptyState icon={Flag} title="No open disputes">
            Disputes raised by players appear here.
          </EmptyState>
        )}
      </section>

      <section className="grid gap-3">
        <SectionTitle>Recent matches</SectionTitle>
        <div className="grid gap-2">
          {recent.data?.map((m) => (
            <div
              key={m.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 text-sm"
            >
              <span>
                <span className="font-mono">@{m.white_username}</span>{" "}
                {m.result === "white" ? "1–0" : m.result === "black" ? "0–1" : "½–½"}{" "}
                <span className="font-mono">@{m.black_username}</span>{" "}
                <span className="text-muted-foreground">· {formatRelative(m.ended_at)}</span>{" "}
                {m.status === "disputed" ? <Badge variant="warning">disputed</Badge> : null}{" "}
                {m.source === "admin" ? <Badge variant="info">moderated</Badge> : null}
              </span>
              <span className="flex items-center gap-2">
                <a
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                  href={m.game_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Game <ExternalLink className="size-3" aria-hidden />
                </a>
                {canAct
                  ? (["white", "black", "draw"] as const)
                      .filter((r) => r !== m.result || m.status === "disputed")
                      .map((r) => (
                        <AdminAction
                          key={r}
                          label={r === "draw" ? "Set draw" : `Set ${r} won`}
                          title="Correct this result?"
                          description="The change is audited and statistics are recomputed immediately."
                          payload={{ action: "correct_match", match_id: m.id, result: r }}
                          success="Result corrected"
                        />
                      ))
                  : null}
              </span>
            </div>
          ))}
          {recent.data?.length === 0 ? (
            <p className="text-sm text-muted-foreground">No matches yet.</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
