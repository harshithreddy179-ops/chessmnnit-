import { cn } from "@/lib/utils";

/** Decorative checkerboard texture; purely visual. */
export function BoardPattern({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "board-pattern pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_top_right,black,transparent_70%)] opacity-60",
        className,
      )}
    />
  );
}
