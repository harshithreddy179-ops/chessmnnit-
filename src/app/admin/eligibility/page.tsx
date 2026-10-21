import { ListChecks } from "lucide-react";
import { AdminAction } from "@/components/admin/admin-action";
import { AllowlistForm } from "@/components/admin/forms";
import { EmptyState, Pagination } from "@/components/data/primitives";
import { Alert } from "@/components/ui/alert";
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
import { can } from "@/lib/admin-ui";
import { intParam, type RawSearchParams } from "@/lib/search-params";
import { formatDate } from "@/lib/utils";
import { requireAdmin } from "@/server/auth";

export const metadata = { title: "Eligibility list" };
const PAGE_SIZE = 50;

export default async function AdminEligibility({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const ctx = await requireAdmin(["verification_admin"]);
  const page = intParam((await searchParams).page, 1, 1, 10_000);
  const canAct = can(ctx.roles, ["verification_admin"]);
  const { data, count } = await ctx.supabase
    .from("student_eligibility")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  return (
    <div className="grid gap-8">
      <Alert variant="info" title="How eligibility works">
        A student becomes eligible when the verified Google email they sign in with is on this list
        (or their domain is, if a super admin added one). Anyone not listed can ask for a manual
        review. Removing an entry stops future matches; use a user’s page to revoke someone already
        verified.
      </Alert>
      {canAct ? (
        <Card>
          <CardHeader>
            <CardTitle>Add students</CardTitle>
          </CardHeader>
          <CardContent>
            <AllowlistForm canAddDomains={can(ctx.roles, [])} />
          </CardContent>
        </Card>
      ) : null}
      {data?.length ? (
        <Card>
          <CardContent className="p-0 sm:p-5">
            <Table>
              <caption className="sr-only">Approved student emails and domains</caption>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Entry</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-mono text-sm">{e.value}</TableCell>
                    <TableCell>
                      <Badge variant={e.kind === "domain" ? "warning" : "neutral"}>{e.kind}</Badge>
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-sm text-muted-foreground">
                      {e.note}
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap text-muted-foreground">
                      {formatDate(e.created_at)}
                      {e.revoked_at ? (
                        <Badge className="ml-2" variant="danger">
                          revoked
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right">
                      {canAct && !e.revoked_at ? (
                        <AdminAction
                          label="Revoke"
                          variant="outline"
                          payload={{ action: "remove_eligibility", id: e.id }}
                          title={`Remove ${e.value}?`}
                          success="Entry revoked"
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
        <EmptyState icon={ListChecks} title="The list is empty">
          Nobody can become eligible automatically until you add students. Students can still
          request a manual review.
        </EmptyState>
      )}
      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={count ?? 0}
        hrefFor={(p) => `/admin/eligibility${p > 1 ? `?page=${p}` : ""}`}
      />
    </div>
  );
}
