import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminAction } from "@/components/admin/admin-action";
import { SetChessLinkButton } from "@/components/admin/forms";
import { ChessLinkBadge, CollegeBadge } from "@/components/chess/badges";
import { SectionTitle, Stat } from "@/components/data/primitives";
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
import { can, ROLE_LABEL } from "@/lib/admin-ui";
import { uuid } from "@/lib/schemas";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/utils";
import { requireAdmin } from "@/server/auth";

export const metadata = { title: "User" };

const LINK_METHOD: Record<string, string> = {
  self_declared: "entered by the player (not verified)",
  admin_review: "set by an administrator",
  profile_code: "confirmed by profile code",
  oauth: "confirmed via OAuth",
};

export default async function AdminUser({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const ctx = await requireAdmin();
  const db = ctx.supabase;
  const [profile, link, claims, roles, challenges, audit, sync] = await Promise.all([
    db.from("profiles").select("*").eq("id", id).maybeSingle(),
    db.from("chess_account_links").select("*").eq("user_id", id).maybeSingle(),
    db
      .from("chess_link_claims")
      .select("*")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
    db.from("admin_roles").select("role").eq("user_id", id),
    db
      .from("challenges")
      .select("id", { count: "exact", head: true })
      .or(`challenger_id.eq.${id},recipient_id.eq.${id}`),
    db
      .from("audit_logs")
      .select("id,action,reason,actor_id,created_at")
      .eq("target_id", id)
      .order("id", { ascending: false })
      .limit(15),
    db.from("chess_sync_state").select("*").eq("user_id", id).maybeSingle(),
  ]);
  if (!profile.data) notFound();
  const p = profile.data;

  // The email lives in Supabase Auth, not in our tables. Only verification admins / super admins see it,
  // fetched server-side with the service key after the role check above.
  let email: string | null = null;
  if (can(ctx.roles, ["verification_admin"])) {
    const admin = createSupabaseAdminClient();
    const res = await admin?.auth.admin.getUserById(id);
    email = res?.data.user?.email ?? null;
  }
  const canVerify = can(ctx.roles, ["verification_admin"]);
  const canModerate = can(ctx.roles, ["verification_admin", "match_moderator"]);

  return (
    <div className="grid gap-8">
      <Link href="/admin/users" className="text-sm text-muted-foreground hover:text-foreground">
        ← All users
      </Link>
      <header className="grid gap-2">
        <h2 className="font-display text-4xl leading-none">{p.display_name}</h2>
        <p className="font-mono text-xs text-muted-foreground">{p.id}</p>
        {email ? (
          <p className="text-sm text-muted-foreground">Google email (private): {email}</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <CollegeBadge verified={p.eligibility_status === "verified"} />
          <ChessLinkBadge linked={Boolean(link.data)} />
          {p.account_status === "suspended" ? <Badge variant="danger">Suspended</Badge> : null}
          {p.is_approved ? (
            <Badge variant="success">Public</Badge>
          ) : (
            <Badge variant="neutral">Hidden</Badge>
          )}
          {roles.data?.map((r) => (
            <Badge key={r.role} variant="info">
              {ROLE_LABEL[r.role]}
            </Badge>
          ))}
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Eligibility"
          value={p.eligibility_status}
          hint={p.eligibility_source ?? undefined}
        />
        <Stat label="Onboarding" value={p.onboarding_completed_at ? "Complete" : "Incomplete"} />
        <Stat label="Challenges" value={challenges.count ?? 0} />
        <Stat
          label="Last sync"
          value={sync.data?.last_success_at ? "OK" : "—"}
          hint={sync.data?.last_error ?? undefined}
        />
      </dl>

      <section className="grid gap-3">
        <SectionTitle>Actions</SectionTitle>
        <div className="flex flex-wrap gap-2">
          {canModerate ? (
            p.account_status === "suspended" ? (
              <AdminAction
                label="Reinstate"
                payload={{ action: "set_account_status", user_id: id, suspend: false }}
                title="Reinstate this player?"
                description="They regain access and reappear if all checks are still met."
                success="Player reinstated"
              />
            ) : (
              <AdminAction
                label="Suspend"
                variant="destructive"
                payload={{ action: "set_account_status", user_id: id, suspend: true }}
                title="Suspend this player?"
                description="They are hidden everywhere, signed out of new sessions, and their open challenges are cancelled or sent for review."
                success="Player suspended"
              />
            )
          ) : null}
          {canVerify ? (
            <SetChessLinkButton userId={id} current={link.data?.chess_username ?? null} />
          ) : null}
          {canVerify && link.data ? (
            <AdminAction
              label="Unlink Chess.com"
              variant="destructive"
              payload={{ action: "unlink_account", user_id: id }}
              title={`Unlink @${link.data.chess_username}?`}
              description="The player loses their public listing until an account is linked again. The link is archived for audit."
              success="Chess.com account unlinked"
            />
          ) : null}
          {canVerify && p.eligibility_status !== "verified" ? (
            <AdminAction
              label="Mark eligible"
              payload={{ action: "set_user_eligibility", user_id: id, status: "verified" }}
              title="Mark this student eligible?"
              success="Eligibility set"
            />
          ) : null}
          {canVerify && p.eligibility_status === "verified" ? (
            <AdminAction
              label="Revoke eligibility"
              variant="destructive"
              payload={{ action: "set_user_eligibility", user_id: id, status: "revoked" }}
              title="Revoke eligibility?"
              description="They are hidden from public lists and their open challenges are handled."
              success="Eligibility revoked"
            />
          ) : null}
          {canVerify ? (
            <AdminAction
              label="Retry Chess.com sync"
              needsReason={false}
              payload={{ action: "retry_player_sync", user_id: id }}
              success="Queued for the next sync"
            />
          ) : null}
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Chess.com link</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {link.data ? (
            <p>
              @{link.data.chess_username} · player id {link.data.chess_player_id ?? "unknown"} ·{" "}
              {LINK_METHOD[link.data.verification_method] ?? link.data.verification_method} · linked{" "}
              {formatDateTime(link.data.verified_at)}
            </p>
          ) : (
            <p className="text-muted-foreground">No Chess.com account linked.</p>
          )}
          {claims.data?.length ? (
            <Table className="mt-4">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Claim</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {claims.data.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs">@{c.chess_username}</TableCell>
                    <TableCell>
                      <Badge variant="neutral">{c.status}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">{c.method}</TableCell>
                    <TableCell className="text-xs">{formatDateTime(c.created_at)}</TableCell>
                    <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
                      {c.review_reason ?? ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>

      <section className="grid gap-3">
        <SectionTitle>Audit trail for this user</SectionTitle>
        <ul className="grid gap-2 text-sm">
          {audit.data?.map((a) => (
            <li
              key={a.id}
              className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border bg-card px-3 py-2"
            >
              <span>
                <span className="font-mono text-xs">{a.action}</span>
                {a.reason ? <span className="text-muted-foreground"> — {a.reason}</span> : null}
              </span>
              <span className="text-xs text-muted-foreground">{formatDateTime(a.created_at)}</span>
            </li>
          ))}
          {audit.data?.length === 0 ? (
            <li className="text-muted-foreground">Nothing recorded.</li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}
