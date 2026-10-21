export type RawSearchParams = Record<string, string | string[] | undefined>;

export function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function pick<T extends string>(
  v: string | string[] | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  const s = one(v);
  return s && (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
}

export function intParam(
  v: string | string[] | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = Number.parseInt(one(v) ?? "", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export function optionalInt(
  v: string | string[] | undefined,
  min: number,
  max: number,
): number | undefined {
  const n = Number.parseInt(one(v) ?? "", 10);
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
}

/** Builds a query string from the defined, non-empty values. */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "" || v === false) continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}
