import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto grid max-w-5xl gap-6 px-4 py-10" role="status" aria-label="Loading">
      <Skeleton className="h-12 w-64" />
      <Skeleton className="h-5 w-96 max-w-full" />
      <div className="grid gap-3">
        {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-14 w-full" />)}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
