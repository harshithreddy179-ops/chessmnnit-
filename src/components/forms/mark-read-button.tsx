"use client";

import { CheckCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useNotifications } from "@/components/realtime/notifications";
import { Button } from "@/components/ui/button";

export function MarkAllRead({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const n = useNotifications();
  return (
    <Button variant="outline" size="sm" disabled={disabled} onClick={async () => { await n?.markAllRead(); router.refresh(); }}>
      <CheckCheck aria-hidden /> Mark all as read
    </Button>
  );
}
