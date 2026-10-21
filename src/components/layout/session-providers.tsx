import { NotificationsProvider } from "@/components/realtime/notifications";
import { PresenceProvider } from "@/components/realtime/presence";
import { getAppContext } from "@/server/auth";

/**
 * For signed-in members, wraps the app in the realtime providers (presence + notifications).
 * Visitors get the page unchanged.
 */
export async function SessionProviders({ children }: { children: React.ReactNode }) {
  const ctx = await getAppContext();
  if (!ctx) return <>{children}</>;
  const { count } = await ctx.supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);
  return (
    <PresenceProvider userId={ctx.user.id} initialMode={ctx.settings?.presence_mode ?? "available"}>
      <NotificationsProvider userId={ctx.user.id} initialUnread={count ?? 0}>
        {children}
      </NotificationsProvider>
    </PresenceProvider>
  );
}
