"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api, ApiClientError } from "@/lib/api-client";
import {
  aggregatePresence, applyGrace, displayStatus, PRESENCE_CHANNEL, PRESENCE_GRACE_MS, STATUS_LABEL,
  type DisplayStatus, type PresenceMode, type PresenceState, type TrackedUser,
} from "@/lib/presence";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Connection = "connected" | "connecting" | "unavailable";

interface PresenceContextValue {
  userId: string;
  mode: PresenceMode;
  connection: Connection;
  statusOf: (userId: string) => DisplayStatus;
  setMode: (mode: PresenceMode) => Promise<void>;
}

const PresenceContext = createContext<PresenceContextValue | null>(null);

export function usePresence(): PresenceContextValue | null {
  return useContext(PresenceContext);
}

/**
 * Live "who is online" via Supabase Realtime Presence on a private channel.
 *
 * - Every open tab tracks itself under the same key (the user id); the aggregate decides.
 * - Closing a tab / losing the network removes that tab's entry server-side, no flag is
 *   stored in the database, so nothing can stay "online" after the browser closes.
 * - After a reconnect the channel re-subscribes and we track again, and a short grace
 *   period (see lib/presence.ts) hides blips.
 * - "Invisible" users never track, so everyone else sees them as offline.
 */
export function PresenceProvider({ userId, initialMode, children }: { userId: string; initialMode: PresenceMode; children: React.ReactNode }) {
  const [tracked, setTracked] = useState<ReadonlyMap<string, TrackedUser>>(new Map());
  const [connection, setConnection] = useState<Connection>("connecting");
  const [mode, setModeState] = useState<PresenceMode>(initialMode);
  const modeRef = useRef<PresenceMode>(initialMode);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const tabId = useRef<string>("");

  const track = useCallback(async () => {
    const channel = channelRef.current;
    if (!channel) return;
    if (modeRef.current === "invisible") {
      await channel.untrack();
      return;
    }
    await channel.track({ user_id: userId, status: modeRef.current, tab_id: tabId.current, online_at: new Date().toISOString() });
  }, [userId]);

  useEffect(() => {
    tabId.current = crypto.randomUUID();
    const supabase = getBrowserSupabase();
    if (!supabase) {
      // Not configured: presence is genuinely unavailable (never shown as "everyone offline").
      const t = setTimeout(() => setConnection("unavailable"), 0);
      return () => clearTimeout(t);
    }
    let cancelled = false;
    const channel = supabase.channel(PRESENCE_CHANNEL, { config: { presence: { key: userId }, private: true } });
    channelRef.current = channel;

    const sync = () => {
      const current = aggregatePresence(channel.presenceState() as unknown as PresenceState);
      setTracked((previous) => applyGrace(previous, current, Date.now(), PRESENCE_GRACE_MS));
    };
    channel.on("presence", { event: "sync" }, sync);

    void (async () => {
      try {
        await supabase.realtime.setAuth();
      } catch {
        // subscribe() below will report the failure
      }
      if (cancelled) return;
      channel.subscribe((status) => {
        if (cancelled) return;
        if (status === "SUBSCRIBED") {
          setConnection("connected");
          void track(); // runs again after every automatic reconnect
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setConnection("unavailable");
        } else if (status === "CLOSED") {
          setConnection("connecting");
        }
      });
    })();

    // Let users who vanished age out of the grace window even if no further sync arrives.
    const sweep = setInterval(sync, 3_000);
    const leave = () => void channel.untrack();
    window.addEventListener("pagehide", leave);

    return () => {
      cancelled = true;
      clearInterval(sweep);
      window.removeEventListener("pagehide", leave);
      void channel.untrack();
      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [userId, track]);

  const setMode = useCallback(
    async (next: PresenceMode) => {
      const previous = modeRef.current;
      modeRef.current = next;
      setModeState(next);
      void track();
      try {
        await api("/api/settings/presence", { method: "PATCH", body: { presence_mode: next } });
      } catch (error) {
        modeRef.current = previous;
        setModeState(previous);
        void track();
        toast.error(error instanceof ApiClientError ? error.message : "Could not change your status.");
      }
    },
    [track],
  );

  const value = useMemo<PresenceContextValue>(
    () => ({
      userId,
      mode,
      connection,
      setMode,
      statusOf: (id) => (id === userId ? (mode === "invisible" ? "offline" : mode) : displayStatus(tracked, id, connection)),
    }),
    [userId, mode, connection, tracked, setMode],
  );

  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}

const DOT: Record<DisplayStatus, string> = {
  available: "bg-success",
  busy: "bg-warning",
  offline: "bg-muted-foreground/40",
  unknown: "border border-dashed border-muted-foreground/60 bg-transparent",
};

/** Small status dot + label for a player. Renders nothing for signed-out visitors. */
export function PresenceDot({ userId, withLabel = true, className }: { userId: string; withLabel?: boolean; className?: string }) {
  const presence = usePresence();
  if (!presence) return null;
  const status = presence.statusOf(userId);
  const own = userId === presence.userId && presence.mode === "invisible";
  const label = own ? "Invisible (only you see this)" : STATUS_LABEL[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", className)} title={label}>
      <span aria-hidden className={cn("size-2 rounded-full", DOT[status], status === "available" && "animate-pulse-ring")} />
      {withLabel ? <span>{label}</span> : <span className="sr-only">{label}</span>}
    </span>
  );
}

/** Whether a user is currently online (for the "online only" filter). */
export function useIsOnline(userId: string): boolean {
  const presence = usePresence();
  const status = presence?.statusOf(userId);
  return status === "available" || status === "busy";
}
