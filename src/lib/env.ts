/**
 * Environment access that is safe to import from both server and client code.
 *
 * Nothing in here throws when a variable is missing: the app must keep rendering
 * (with an explicit "awaiting configuration" state) instead of crashing when an
 * integration has not been set up yet.
 *
 * NOTE: NEXT_PUBLIC_* variables must be referenced with their literal names so the
 * bundler can inline them into the browser build.
 */
import { z } from "zod";

export interface PublicSupabaseConfig {
  url: string;
  /** Publishable key (sb_publishable_…) or the legacy anon JWT. Safe for browsers. */
  key: string;
}

const httpUrl = z.url({ protocol: /^https?$/ });

export function getPublicSupabaseConfig(): PublicSupabaseConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  if (!httpUrl.safeParse(url).success) return null;
  return { url, key };
}

export function isSupabaseConfigured(): boolean {
  return getPublicSupabaseConfig() !== null;
}

export function getAppUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit && httpUrl.safeParse(explicit).success) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

export const SITE = {
  name: "MNNIT Chess",
  fullName: "MNNIT Chess Community",
  college: "Motilal Nehru National Institute of Technology Allahabad",
  tagline: "The competitive chess community of MNNIT Allahabad.",
} as const;
