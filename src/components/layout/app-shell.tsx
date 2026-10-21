import Link from "next/link";
import { Brand } from "@/components/brand";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { UserMenu } from "@/components/layout/user-menu";
import { NotificationBell } from "@/components/realtime/notifications";
import { PresenceDot } from "@/components/realtime/presence";
import { ThemeToggle } from "@/components/theme-toggle";
import type { AppContext } from "@/server/auth";

/** Sidebar on desktop, scrolling tab bar on small screens. */
export function AppShell({ ctx, children }: { ctx: AppContext; children: React.ReactNode }) {
  const isAdmin = ctx.roles.length > 0;
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      <aside className="hidden border-r bg-card/40 md:block">
        <div className="sticky top-0 flex h-dvh flex-col gap-6 p-4">
          <Brand />
          <SidebarNav isAdmin={isAdmin} />
          <div className="mt-auto grid gap-2 rounded-lg border bg-card p-3 text-sm">
            <p className="truncate font-medium">{ctx.profile.display_name}</p>
            {ctx.link ? (
              <Link
                href={`/players/${ctx.link.chess_username}`}
                className="truncate text-xs text-muted-foreground hover:text-foreground"
              >
                @{ctx.link.chess_username}
              </Link>
            ) : (
              <span className="text-xs text-muted-foreground">Chess.com not linked yet</span>
            )}
            <PresenceDot userId={ctx.user.id} />
          </div>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur md:px-8">
          <div className="md:hidden">
            <Brand />
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <ThemeToggle />
            <NotificationBell />
            <UserMenu
              name={ctx.profile.display_name}
              avatarUrl={ctx.profile.avatar_url}
              isAdmin={isAdmin}
            />
          </div>
        </header>
        <div className="border-b px-2 py-1.5 md:hidden">
          <SidebarNav isAdmin={isAdmin} orientation="horizontal" />
        </div>
        <main id="main" className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 md:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
