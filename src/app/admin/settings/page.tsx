import { redirect } from "next/navigation";
import { SettingForm } from "@/components/admin/forms";
import { Alert } from "@/components/ui/alert";
import { can } from "@/lib/admin-ui";
import { requireAdmin } from "@/server/auth";

export const metadata = { title: "Settings" };

export default async function AdminSettings() {
  const ctx = await requireAdmin();
  if (!can(ctx.roles, [])) redirect("/admin");
  const { data } = await ctx.supabase.from("app_settings").select("*").order("key");
  return (
    <div className="grid gap-6">
      <Alert variant="warning" title="These change how every player is scored and matched">
        Changes are audited. Scoring settings (points, Elo) apply the next time statistics are
        recomputed, which happens whenever a match result changes.
      </Alert>
      {data?.map((s) => (
        <SettingForm key={s.key} settingKey={s.key} value={s.value} description={s.description} />
      ))}
    </div>
  );
}
