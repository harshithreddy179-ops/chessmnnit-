import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder for list-style pages while data streams in. */
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="grid gap-4" role="status" aria-label="Loading">
      <Skeleton className="h-10 w-72 max-w-full" />
      <div className="grid gap-3">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
