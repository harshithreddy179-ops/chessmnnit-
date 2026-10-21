"use client";

import { Bell, BellRing } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api-client";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { formatRelative } from "@/lib/utils";

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

interface NotificationsValue {
  unread: number;
  live: "live" | "connecting" | "offline";
  markAllRead: () => Promise<void>;
}
const Ctx = createContext<NotificationsValue | null>(null);
export const useNotifications = () => useContext(Ctx);

/** href a notification should open, derived from its payload. */
export function notificationHref(n: Pick<NotificationItem, "data" | "type">): string {
  const challengeId = n.data?.challenge_id;
  if (typeof challengeId === "string") return `/challenges/${challengeId}`;
  if (
    n.type === "verification_result" ||
    n.type === "eligibility_result" ||
    n.type === "recovery_decision"
  )
    return "/settings";
  return "/notifications";
}

/**
 * Realtime notifications. Supabase Postgres Changes are filtered by RLS per subscriber: this
 * client only ever receives its own notifications and challenges it takes part in.
 * Without Realtime the app still works — the notification centre reads from the database.
 */
export function NotificationsProvider({
  userId,
  initialUnread,
  children,
}: {
  userId: string;
  initialUnread: number;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [unread, setUnread] = useState(initialUnread);
  const [live, setLive] = useState<NotificationsValue["live"]>("connecting");
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), 400);
  }, [router]);

  useEffect(() => {
    const supabase = getBrowserSupabase();
    if (!supabase) {
      const t = setTimeout(() => setLive("offline"), 0);
      return () => clearTimeout(t);
    }
    const channel = supabase
      .channel(`inbox:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const n = payload.new as NotificationItem;
          setUnread((c) => c + 1);
          toast(n.title, {
            description: n.body || undefined,
            action: { label: "Open", onClick: () => router.push(notificationHref(n)) },
          });
          scheduleRefresh();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "challenges" },
        scheduleRefresh,
      )
      .subscribe((status) => {
        setLive(status === "SUBSCRIBED" ? "live" : status === "CLOSED" ? "connecting" : "offline");
      });
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      void supabase.removeChannel(channel);
    };
  }, [userId, router, scheduleRefresh]);

  const markAllRead = useCallback(async () => {
    setUnread(0);
    try {
      await api("/api/notifications/read", { body: { all: true } });
    } catch {
      toast.error("Could not mark notifications as read.");
    }
  }, []);

  const value = useMemo(() => ({ unread, live, markAllRead }), [unread, live, markAllRead]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function NotificationBell() {
  const ctx = useNotifications();
  const [items, setItems] = useState<NotificationItem[] | null>(null);

  const load = async () => {
    const supabase = getBrowserSupabase();
    if (!supabase) return setItems([]);
    const { data } = await supabase
      .from("notifications")
      .select("id,type,title,body,data,read_at,created_at")
      .order("created_at", { ascending: false })
      .limit(6);
    setItems((data ?? []) as NotificationItem[]);
  };

  const unread = ctx?.unread ?? 0;
  return (
    <DropdownMenu onOpenChange={(open) => open && void load()}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
          className="relative"
        >
          {unread ? <BellRing aria-hidden /> : <Bell aria-hidden />}
          {unread ? (
            <span className="tabular absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] leading-4 font-semibold text-primary-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Notifications</span>
          <span className="text-[11px]">
            {ctx?.live === "live"
              ? "Live"
              : ctx?.live === "connecting"
                ? "Connecting…"
                : "Live updates paused"}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items === null ? (
          <p className="px-3 py-4 text-sm text-muted-foreground">Loading…</p>
        ) : null}
        {items?.length === 0 ? (
          <p className="px-3 py-4 text-sm text-muted-foreground">
            Nothing yet. Challenges and results will show up here.
          </p>
        ) : null}
        {items?.map((n) => (
          <DropdownMenuItem key={n.id} asChild>
            <Link href={notificationHref(n)} className="grid gap-0.5">
              <span className="flex items-center gap-2 text-sm font-medium">
                {!n.read_at ? (
                  <span aria-label="unread" className="size-1.5 rounded-full bg-primary" />
                ) : null}
                {n.title}
              </span>
              <span className="text-xs text-muted-foreground">{formatRelative(n.created_at)}</span>
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/notifications" className="justify-center text-sm font-medium">
            Open notification centre
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
