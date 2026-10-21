"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export interface AdminNavItem {
  href: string;
  label: string;
  count?: number;
}

export function AdminNav({ items }: { items: AdminNavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin sections" className="scrollbar-thin flex gap-1 overflow-x-auto border-b">
      {items.map((i) => {
        const active = i.href === "/admin" ? pathname === "/admin" : pathname.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href} aria-current={active ? "page" : undefined}
            className={cn("-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap", active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {i.label}
            {i.count ? <span className="tabular rounded-full bg-danger/15 px-1.5 text-xs text-danger">{i.count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
