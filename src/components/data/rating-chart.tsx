import { chartGeometry, hasEnoughHistory, type RatingPoint } from "@/lib/rating-history";
import { formatDate } from "@/lib/utils";

/**
 * Rating history as an accessible inline SVG. Renders nothing unless there is enough data
 * to say something true (see hasEnoughHistory).
 */
export function RatingChart({ points, label }: { points: RatingPoint[]; label: string }) {
  if (!hasEnoughHistory(points)) return null;
  const W = 560;
  const H = 160;
  const g = chartGeometry(points, W, H);
  return (
    <figure className="grid gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label} rating history from ${formatDate(g.first)} to ${formatDate(g.last)}, ${g.min} to ${g.max}`} className="h-40 w-full overflow-visible">
        <line x1="0" x2={W} y1={H - 12} y2={H - 12} stroke="var(--border)" />
        <path d={g.path} fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {g.dots.map((d) => (
          <circle key={d.t} cx={d.x} cy={d.y} r="3" fill="var(--background)" stroke="var(--primary)" strokeWidth="2">
            <title>{`${d.rating} on ${formatDate(d.t)}`}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="flex justify-between text-xs text-muted-foreground">
        <span>{formatDate(g.first)}</span>
        <span className="tabular">{g.min} – {g.max}</span>
        <span>{formatDate(g.last)}</span>
      </figcaption>
    </figure>
  );
}
