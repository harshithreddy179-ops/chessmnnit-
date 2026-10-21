import Link from "next/link";
import { Brand } from "@/components/brand";
import { SITE } from "@/lib/env";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="grid content-start gap-3">
          <Brand />
          <p className="max-w-sm text-sm text-muted-foreground">{SITE.college}. An independent student community, not affiliated with Chess.com.</p>
        </div>
        <nav aria-label="Explore" className="grid content-start gap-2 text-sm">
          <p className="font-medium">Explore</p>
          <Link className="text-muted-foreground hover:text-foreground" href="/players">Players</Link>
          <Link className="text-muted-foreground hover:text-foreground" href="/leaderboards">Leaderboards</Link>
          <Link className="text-muted-foreground hover:text-foreground" href="/matches">Match history</Link>
        </nav>
        <nav aria-label="About" className="grid content-start gap-2 text-sm">
          <p className="font-medium">About</p>
          <Link className="text-muted-foreground hover:text-foreground" href="/rules">Scoring &amp; rules</Link>
          <Link className="text-muted-foreground hover:text-foreground" href="/login">Sign in</Link>
        </nav>
      </div>
      <div className="border-t py-4 text-center text-xs text-muted-foreground">
        Chess.com ratings are imported data. They are not earned exclusively against MNNIT students.
      </div>
    </footer>
  );
}
