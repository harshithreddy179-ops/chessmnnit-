import { redirect } from "next/navigation";
import { AdminAction } from "@/components/admin/admin-action";
import { GrantRoleForm } from "@/components/admin/forms";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { can, ROLE_BLURB, ROLE_LABEL } from "@/lib/admin-ui";
import { formatDate } from "@/lib/utils";
import { requireAdmin } from "@/server/auth";
import { nameMap } from "@/server/data/admin";

export const metadata = { title: "Admins" };

export default async function AdminRoles() {
  const ctx = await requireAdmin();
  if (!can(ctx.roles, [])) redirect("/admin");
  const { data } = await ctx.supabase.from("admin_roles").select("*").order("granted_at");
  const names = await nameMap(
    ctx.supabase,
    (data ?? []).map((r) => r.user_id),
  );
  return (
    <div className="grid gap-8">
      <Card>
        <CardHeader>
          <CardTitle>Roles</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          {Object.entries(ROLE_LABEL).map(([k, l]) => (
            <p key={k}>
              <strong>{l}.</strong>{" "}
              <span className="text-muted-foreground">
                {ROLE_BLURB[k as keyof typeof ROLE_BLURB]}
              </span>
            </p>
          ))}
          <p className="text-xs text-muted-foreground">
            Roles live in the database and are enforced there on every action. You can’t change your
            own roles and the last super admin can’t be removed.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0 sm:p-5">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Person</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Since</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.map((r) => (
                <TableRow key={`${r.user_id}-${r.role}`}>
                  <TableCell>
                    {names.get(r.user_id) ?? r.user_id}
                    {r.user_id === ctx.user.id ? (
                      <Badge className="ml-2" variant="neutral">
                        you
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge variant="info">{ROLE_LABEL[r.role]}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(r.granted_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    {r.user_id !== ctx.user.id ? (
                      <AdminAction
                        label="Revoke"
                        variant="outline"
                        payload={{
                          action: "set_role",
                          user_id: r.user_id,
                          role: r.role,
                          grant: false,
                        }}
                        title={`Revoke ${ROLE_LABEL[r.role]}?`}
                        success="Role revoked"
                      />
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Grant a role</CardTitle>
        </CardHeader>
        <CardContent>
          <GrantRoleForm />
        </CardContent>
      </Card>
    </div>
  );
}
