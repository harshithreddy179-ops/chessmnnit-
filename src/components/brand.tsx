import Link from "next/link";
import { ChessKnight } from "lucide-react";
import { cn } from "@/lib/utils";

export function Brand({ className, href = "/" }: { className?: string; href?: string }) {
  return (
    <Link href={href} className={cn("group inline-flex items-center gap-2.5", className)} aria-label="MNNIT Chess home">
      <span className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground transition-transform group-hover:-rotate-6">
        <ChessKnight className="size-5" aria-hidden />
      </span>
      <span className="font-display text-[1.35rem] leading-none tracking-tight">
        MNNIT <span className="text-primary">Chess</span>
      </span>
    </Link>
  );
}
