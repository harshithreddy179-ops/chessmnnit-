import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="grid gap-1.5">
        <h1 className="font-display text-4xl leading-none tracking-tight sm:text-5xl">{title}</h1>
        {description ? (
          <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="grid place-items-center gap-3 rounded-xl border border-dashed px-6 py-14 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="grid gap-1">
        <p className="font-medium">{title}</p>
        {children ? (
          <p className="mx-auto max-w-md text-sm text-muted-foreground">{children}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-1 rounded-lg border bg-card p-4", className)}>
      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="tabular font-mono text-2xl font-semibold">{value}</dd>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Server-friendly pagination built from plain links, so it works without JavaScript. */
export function Pagination({
  page,
  pageSize,
  total,
  hrefFor,
}: {
  page: number;
  pageSize: number;
  total: number;
  hrefFor: (page: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 pt-2 text-sm">
      <p className="text-muted-foreground">
        <span className="tabular">
          {from}–{to}
        </span>{" "}
        of <span className="tabular">{total}</span>
      </p>
      <div className="flex items-center gap-2">
        <Button asChild variant="outline" size="sm" aria-disabled={page <= 1}>
          <Link
            href={hrefFor(Math.max(1, page - 1))}
            aria-label="Previous page"
            tabIndex={page <= 1 ? -1 : undefined}
          >
            <ChevronLeft aria-hidden /> Previous
          </Link>
        </Button>
        <span className="tabular text-muted-foreground">
          Page {page} of {pages}
        </span>
        <Button asChild variant="outline" size="sm" aria-disabled={page >= pages}>
          <Link
            href={hrefFor(Math.min(pages, page + 1))}
            aria-label="Next page"
            tabIndex={page >= pages ? -1 : undefined}
          >
            Next <ChevronRight aria-hidden />
          </Link>
        </Button>
      </div>
    </nav>
  );
}

export function SectionTitle({
  children,
  aside,
}: {
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
        {children}
      </h2>
      {aside}
    </div>
  );
}
