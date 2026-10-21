import { BadgeCheck, CircleDashed, ShieldCheck, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TIME_CLASS_LABEL, type TimeClass } from "@/lib/chess/constants";
import { cn } from "@/lib/utils";

export function TimeClassBadge({ timeClass }: { timeClass: TimeClass | null | undefined }) {
  if (!timeClass) return null;
  return <Badge variant="outline">{TIME_CLASS_LABEL[timeClass]}</Badge>;
}

/** Chess.com rating with its category, so ratings are never shown as one unexplained number. */
export function RatingBadge({ rating, timeClass, className }: { rating: number | null | undefined; timeClass: TimeClass; className?: string }) {
  if (rating === null || rating === undefined) {
    return <span className={cn("text-sm text-muted-foreground", className)}>Not rated in {TIME_CLASS_LABEL[timeClass].toLowerCase()}</span>;
  }
  return (
    <span className={cn("inline-flex items-baseline gap-1.5", className)}>
      <span className="tabular font-mono text-base font-semibold">{rating}</span>
      <span className="text-xs text-muted-foreground">{TIME_CLASS_LABEL[timeClass]}</span>
    </span>
  );
}

export function VerifiedChessBadge({ verified }: { verified: boolean }) {
  return verified ? (
    <Badge variant="success">
      <BadgeCheck aria-hidden /> Chess.com verified
    </Badge>
  ) : (
    <Badge variant="warning">
      <CircleDashed aria-hidden /> Chess.com not verified
    </Badge>
  );
}

export function CollegeBadge({ verified }: { verified: boolean }) {
  return verified ? (
    <Badge variant="success">
      <ShieldCheck aria-hidden /> MNNIT student
    </Badge>
  ) : (
    <Badge variant="warning">
      <TriangleAlert aria-hidden /> Eligibility pending
    </Badge>
  );
}

export function DemoBadge() {
  return <Badge variant="warning">Demo data</Badge>;
}

export function ResultBadge({ outcome }: { outcome: "win" | "loss" | "draw" }) {
  const map = { win: ["success", "Win"], loss: ["danger", "Loss"], draw: ["neutral", "Draw"] } as const;
  const [variant, label] = map[outcome];
  return <Badge variant={variant}>{label}</Badge>;
}

export function RankMark({ rank }: { rank: number }) {
  const medal = rank === 1 ? "text-warning" : rank === 2 ? "text-muted-foreground" : rank === 3 ? "text-[#c98a5a]" : "";
  return (
    <span className={cn("tabular inline-flex size-7 items-center justify-center rounded-md border font-mono text-xs font-semibold", rank <= 3 ? `border-current ${medal}` : "text-muted-foreground")}>
      {rank}
    </span>
  );
}
