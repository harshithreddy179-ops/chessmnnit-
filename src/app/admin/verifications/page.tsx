import Link from "next/link";
import { ExternalLink, Inbox } from "lucide-react";
import { AdminAction } from "@/components/admin/admin-action";
import { EmptyState, SectionTitle } from "@/components/data/primitives";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { can } from "@/lib/admin-ui";
import { chessProfileUrl } from "@/lib/chess/username";
import { formatRelative } from "@/lib/utils";
import { requireAdmin } from "@/server/auth";
import { nameMap } from "@/server/data/admin";

export const metadata = { title: "Verifications" };

export default async function AdminVerifications() {
  const ctx = await requireAdmin(["verification_admin"]);
  const db = ctx.supabase;
  const canAct = can(ctx.roles, ["verification_admin"]);
  const [claims, eligibility, recovery] = await Promise.all([
    db
      .from("chess_link_claims")
      .select("*")
      .eq("status", "needs_review")
      .order("created_at")
      .limit(50),
    db.from("eligibility_requests").select("*").eq("status", "open").order("created_at").limit(50),
    db
      .from("account_recovery_requests")
      .select("*")
      .eq("status", "open")
      .order("created_at")
      .limit(50),
  ]);
  const holders = recovery.data?.length
    ? await db
        .from("chess_account_links")
        .select("user_id,chess_username")
        .in(
          "chess_username",
          recovery.data.map((r) => r.requested_username),
        )
    : { data: [] };
  const names = await nameMap(db, [
    ...(claims.data ?? []).map((c) => c.user_id),
    ...(eligibility.data ?? []).map((e) => e.user_id),
    ...(recovery.data ?? []).map((r) => r.requester_id),
    ...(holders.data ?? []).map((h) => h.user_id),
  ]);
  const holderOf = new Map((holders.data ?? []).map((h) => [h.chess_username, h.user_id]));

  return (
    <div className="grid gap-10">
      {!canAct ? (
        <Alert variant="info">
          You can view these queues, but only verification admins can decide them.
        </Alert>
      ) : null}

      <section className="grid gap-3">
        <SectionTitle>Chess.com ownership claims waiting for review</SectionTitle>
        {claims.data?.length ? (
          claims.data.map((c) => (
            <Card key={c.id}>
              <CardContent className="grid gap-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="grid gap-0.5">
                    <p className="font-medium">
                      <Link className="hover:underline" href={`/admin/users/${c.user_id}`}>
                        {names.get(c.user_id) ?? "Unknown"}
                      </Link>{" "}
                      claims{" "}
                      <a
                        className="inline-flex items-center gap-1 font-mono text-primary hover:underline"
                        href={chessProfileUrl(c.chess_username)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        @{c.chess_username} <ExternalLink className="size-3" aria-hidden />
                      </a>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Submitted {formatRelative(c.created_at)} · automatic checks tried:{" "}
                      {c.attempts}
                      {c.last_check_result ? ` (last: ${c.last_check_result})` : ""}
                    </p>
                  </div>
                  {canAct ? (
                    <div className="flex gap-2">
                      <AdminAction
                        label="Approve"
                        variant="default"
                        title={`Approve @${c.chess_username}?`}
                        description="Only approve once you are confident this person controls the account. You can ask them to add the code to their profile, or check in person. The ownership link becomes permanent for them."
                        payload={{ action: "review_claim", claim_id: c.id, approve: true }}
                        reasonLabel="How did you confirm ownership?"
                        success="Chess.com account verified"
                      />
                      <AdminAction
                        label="Reject"
                        variant="outline"
                        title="Reject this claim?"
                        description="The student is notified with your reason."
                        payload={{ action: "review_claim", claim_id: c.id, approve: false }}
                        reasonLabel="Reason (shown to the student)"
                        success="Claim rejected"
                      />
                    </div>
                  ) : null}
                </div>
                <p className="rounded-md bg-muted p-3 text-sm">
                  {(c.evidence as { player_note?: string }).player_note ?? "No note."}
                </p>
                <p className="font-mono text-xs text-muted-foreground">
                  Their one-time code: {c.verification_code} — if their public profile shows it,
                  ownership is proven.
                </p>
              </CardContent>
            </Card>
          ))
        ) : (
          <EmptyState icon={Inbox} title="No claims waiting">
            Students who can’t use the automatic code check appear here.
          </EmptyState>
        )}
      </section>

      <section className="grid gap-3">
        <SectionTitle>Student eligibility requests</SectionTitle>
        {eligibility.data?.length ? (
          eligibility.data.map((e) => (
            <Card key={e.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="grid gap-0.5">
                  <p className="font-medium">
                    <Link className="hover:underline" href={`/admin/users/${e.user_id}`}>
                      {names.get(e.user_id) ?? "Unknown"}
                    </Link>{" "}
                    · {e.claimed_identifier}
                  </p>
                  {e.note ? <p className="text-sm text-muted-foreground">{e.note}</p> : null}
                  <p className="text-xs text-muted-foreground">{formatRelative(e.created_at)}</p>
                </div>
                {canAct ? (
                  <div className="flex gap-2">
                    <AdminAction
                      label="Approve"
                      variant="default"
                      title="Mark as an MNNIT student?"
                      payload={{ action: "review_eligibility_request", id: e.id, approve: true }}
                      reasonLabel="How did you verify them?"
                      success="Student approved"
                    />
                    <AdminAction
                      label="Reject"
                      title="Reject this request?"
                      payload={{ action: "review_eligibility_request", id: e.id, approve: false }}
                      reasonLabel="Reason (shown to the student)"
                      success="Request rejected"
                    />
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))
        ) : (
          <EmptyState icon={Inbox} title="No eligibility requests">
            Students not on the allowlist can ask for a review; requests appear here.
          </EmptyState>
        )}
      </section>

      <section className="grid gap-3">
        <SectionTitle>Account recovery & duplicate claims</SectionTitle>
        {recovery.data?.length ? (
          recovery.data.map((r) => {
            const holder = holderOf.get(r.requested_username);
            return (
              <Card key={r.id}>
                <CardContent className="grid gap-3 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="grid gap-0.5">
                      <p className="font-medium">
                        <Link className="hover:underline" href={`/admin/users/${r.requester_id}`}>
                          {names.get(r.requester_id) ?? "Unknown"}
                        </Link>{" "}
                        <Badge variant="neutral">
                          {r.kind === "change_username" ? "Change account" : "Take over username"}
                        </Badge>
                      </p>
                      <p className="text-sm">
                        Account: <span className="font-mono">@{r.requested_username}</span>
                        {holder ? (
                          <>
                            {" "}
                            · currently linked to{" "}
                            <Link className="underline" href={`/admin/users/${holder}`}>
                              {names.get(holder) ?? "another member"}
                            </Link>
                          </>
                        ) : (
                          " · not linked to anyone"
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatRelative(r.created_at)}
                      </p>
                    </div>
                    {canAct ? (
                      <div className="flex gap-2">
                        <AdminAction
                          label="Approve"
                          variant="default"
                          title="Approve this recovery?"
                          description={
                            r.kind === "change_username"
                              ? "Their current Chess.com link is removed (archived). They must then verify the new account normally."
                              : "The current holder’s link is removed (archived) and notified. The requester must still verify ownership through the normal process."
                          }
                          payload={{ action: "resolve_recovery", request_id: r.id, approve: true }}
                          reasonLabel="How did you confirm this?"
                          success="Recovery approved"
                        />
                        <AdminAction
                          label="Reject"
                          title="Reject this request?"
                          payload={{ action: "resolve_recovery", request_id: r.id, approve: false }}
                          reasonLabel="Reason (shown to the student)"
                          success="Recovery rejected"
                        />
                      </div>
                    ) : null}
                  </div>
                  <p className="rounded-md bg-muted p-3 text-sm">{r.reason}</p>
                </CardContent>
              </Card>
            );
          })
        ) : (
          <EmptyState icon={Inbox} title="No recovery requests">
            Requests to change or reclaim a Chess.com link appear here.
          </EmptyState>
        )}
      </section>
    </div>
  );
}
