"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  Swords,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useNotifications } from "@/components/realtime/notifications";
import { cn } from "@/lib/utils";

interface Item {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: "unread";
}

const ITEMS: Item[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/challenges", label: "Challenges", icon: Swords },
  { href: "/players", label: "Players", icon: Users },
  { href: "/leaderboards", label: "Leaderboards", icon: Trophy },
  { href: "/notifications", label: "Notifications", icon: Bell, badge: "unread" },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function SidebarNav({
  isAdmin,
  orientation = "vertical",
}: {
  isAdmin: boolean;
  orientation?: "vertical" | "horizontal";
}) {
  const pathname = usePathname();
  const notifications = useNotifications();
  const items = isAdmin
    ? [...ITEMS, { href: "/admin", label: "Admin", icon: ShieldCheck } satisfies Item]
    : ITEMS;
  return (
    <nav
      aria-label="App"
      className={cn(
        orientation === "vertical" ? "grid gap-1" : "flex scrollbar-thin gap-1 overflow-x-auto",
      )}
    >
      {items.map(({ href, label, icon: Icon, badge }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
              active
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
            {badge === "unread" && notifications && notifications.unread > 0 ? (
              <span className="tabular ml-auto rounded-full bg-primary px-1.5 text-[10px] leading-4 font-semibold text-primary-foreground">
                {notifications.unread}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
