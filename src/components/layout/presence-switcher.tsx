"use client";

import { NativeSelect } from "@/components/ui/native-select";
import { usePresence } from "@/components/realtime/presence";
import type { PresenceMode } from "@/lib/presence";

export function PresenceSwitcher({ id = "presence-mode" }: { id?: string }) {
  const presence = usePresence();
  if (!presence) return null;
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        My status
      </label>
      <NativeSelect
        id={id}
        value={presence.mode}
        onChange={(e) => void presence.setMode(e.target.value as PresenceMode)}
        className="h-8 text-xs"
      >
        <option value="available">Available</option>
        <option value="busy">Busy</option>
        <option value="invisible">Invisible (hide my presence)</option>
      </NativeSelect>
    </div>
  );
}
