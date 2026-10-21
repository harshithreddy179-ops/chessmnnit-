import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { AdminNav, type AdminNavItem } from "@/components/admin/admin-nav";
import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { can, ROLE_LABEL } from "@/lib/admin-ui";
import { requireAdmin } from "@/server/auth";
import { getOverview } from "@/server/data/admin";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Admin" },
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Roles are read from the database; the pages and every action re-check them.
  const ctx = await requireAdmin();
  const overview = await getOverview(ctx.supabase).catch(() => null);
  const q = overview?.queues;
  // Mirrors each page's own gate (which redirects), so nobody is offered a link that bounces them back.
  const items: AdminNavItem[] = [
    { href: "/admin", label: "Overview" },
    { href: "/admin/users", label: "Users" },
    ...(can(ctx.roles, ["verification_admin"])
      ? [
          {
            href: "/admin/verifications",
            label: "Verifications",
            count: q ? q.claims_needing_review + q.eligibility_requests + q.recovery_requests : 0,
          },
        ]
      : []),
    ...(can(ctx.roles, ["verification_admin"])
      ? [{ href: "/admin/eligibility", label: "Eligibility list" }]
      : []),
    ...(can(ctx.roles, ["match_moderator"])
      ? [
          {
            href: "/admin/matches",
            label: "Matches",
            count: q ? q.challenges_needing_review + q.open_disputes : 0,
          },
        ]
      : []),
    { href: "/admin/sync", label: "Sync & jobs" },
    { href: "/admin/audit", label: "Audit log" },
    ...(can(ctx.roles, [])
      ? [
          { href: "/admin/roles", label: "Admins" },
          { href: "/admin/settings", label: "Settings" },
        ]
      : []),
  ];
  return (
    <AppShell ctx={ctx}>
      <div className="grid gap-6">
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid size-9 place-items-center rounded-md bg-accent text-accent-foreground">
            <ShieldCheck className="size-5" aria-hidden />
          </span>
          <h1 className="font-display text-4xl leading-none">Administration</h1>
          <span className="flex flex-wrap gap-1.5">
            {ctx.roles.map((r) => (
              <Badge key={r} variant="info">
                {ROLE_LABEL[r]}
              </Badge>
            ))}
          </span>
        </div>
        <AdminNav items={items} />
        {children}
      </div>
    </AppShell>
  );
}
