import Link from "next/link";
import { Brand } from "@/components/brand";
import { MobileNav } from "@/components/layout/mobile-nav";
import { NotificationBell } from "@/components/realtime/notifications";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { Button } from "@/components/ui/button";
import { getAppContext } from "@/server/auth";

export const PUBLIC_LINKS = [
  { href: "/players", label: "Players" },
  { href: "/leaderboards", label: "Leaderboards" },
  { href: "/matches", label: "Matches" },
  { href: "/rules", label: "Rules" },
];

export async function SiteHeader() {
  const ctx = await getAppContext();
  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Brand />
        <nav aria-label="Main" className="ml-6 hidden items-center gap-1 md:flex">
          {PUBLIC_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <ThemeToggle />
          {ctx ? (
            <>
              <NotificationBell />
              <UserMenu name={ctx.profile.display_name} avatarUrl={ctx.profile.avatar_url} isAdmin={ctx.roles.length > 0} />
            </>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
                <Link href="/login">Sign in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/login?join=1">Join the club</Link>
              </Button>
            </>
          )}
          <MobileNav links={ctx ? [{ href: "/dashboard", label: "Dashboard" }, ...PUBLIC_LINKS] : [{ href: "/login", label: "Sign in" }, ...PUBLIC_LINKS]} />
        </div>
      </div>
    </header>
  );
}
