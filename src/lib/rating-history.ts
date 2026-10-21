export interface RatingPoint {
  t: string; // ISO timestamp
  rating: number;
}

/**
 * A rating-history chart is only honest with enough data. Require at least three recorded
 * ratings spread over at least two calendar days; fewer points would draw a misleading line
 * (or a single dot) and imply a trend that does not exist yet.
 */
export function hasEnoughHistory(points: readonly RatingPoint[]): boolean {
  if (points.length < 3) return false;
  const days = new Set(points.map((p) => p.t.slice(0, 10)));
  return days.size >= 2;
}

export interface ChartGeometry {
  path: string;
  min: number;
  max: number;
  first: string;
  last: string;
  dots: { x: number; y: number; rating: number; t: string }[];
}

/** Maps points into an SVG viewBox (padded), keeping the y-axis from collapsing on flat data. */
export function chartGeometry(points: readonly RatingPoint[], width: number, height: number, pad = 12): ChartGeometry {
  const sorted = [...points].sort((a, b) => a.t.localeCompare(b.t));
  const times = sorted.map((p) => new Date(p.t).getTime());
  const t0 = times[0]!;
  const t1 = times[times.length - 1]!;
  const ratings = sorted.map((p) => p.rating);
  let min = Math.min(...ratings);
  let max = Math.max(...ratings);
  if (max - min < 20) {
    min -= 10;
    max += 10;
  }
  const x = (t: number) => (t1 === t0 ? width / 2 : pad + ((t - t0) / (t1 - t0)) * (width - pad * 2));
  const y = (r: number) => height - pad - ((r - min) / (max - min)) * (height - pad * 2);
  const dots = sorted.map((p, i) => ({ x: x(times[i]!), y: y(p.rating), rating: p.rating, t: p.t }));
  const path = dots.map((d, i) => `${i === 0 ? "M" : "L"}${d.x.toFixed(1)},${d.y.toFixed(1)}`).join(" ");
  return { path, min, max, first: sorted[0]!.t, last: sorted[sorted.length - 1]!.t, dots };
}
