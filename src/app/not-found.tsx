import Link from "next/link";
import { ChessKnight } from "lucide-react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main id="main" className="mx-auto grid min-h-dvh max-w-lg content-center justify-items-center gap-6 px-4 text-center">
      <Brand />
      <span className="grid size-16 place-items-center rounded-full bg-muted text-muted-foreground"><ChessKnight className="size-8" aria-hidden /></span>
      <h1 className="font-display text-5xl">That square is empty</h1>
      <p className="text-muted-foreground">The page you were looking for doesn’t exist, or the player is not listed publicly.</p>
      <div className="flex flex-wrap justify-center gap-3">
        <Button asChild><Link href="/">Back to home</Link></Button>
        <Button asChild variant="outline"><Link href="/players">Browse players</Link></Button>
      </div>
    </main>
  );
}
