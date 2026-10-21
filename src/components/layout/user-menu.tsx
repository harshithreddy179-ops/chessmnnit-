"use client";

import Link from "next/link";
import { LayoutDashboard, LogOut, Settings, ShieldCheck } from "lucide-react";
import { PlayerAvatar } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PresenceSwitcher } from "@/components/layout/presence-switcher";

export function UserMenu({ name, avatarUrl, isAdmin }: { name: string; avatarUrl: string | null; isAdmin: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" aria-label="Account menu">
        <PlayerAvatar name={name} src={avatarUrl} />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60">
        <DropdownMenuLabel className="truncate text-sm font-medium text-foreground">{name}</DropdownMenuLabel>
        <div className="px-1.5 pb-1.5">
          <PresenceSwitcher />
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/dashboard"><LayoutDashboard aria-hidden /> Dashboard</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings"><Settings aria-hidden /> Settings</Link>
        </DropdownMenuItem>
        {isAdmin ? (
          <DropdownMenuItem asChild>
            <Link href="/admin"><ShieldCheck aria-hidden /> Admin</Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <form action="/auth/signout" method="post">
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full"><LogOut aria-hidden /> Sign out</button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
