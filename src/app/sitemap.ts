import type { MetadataRoute } from "next";
import { getAppUrl } from "@/lib/env";
import { createSupabasePublicClient } from "@/lib/supabase/server";

// Rebuilt at most hourly. A build without database access still produces the static entries.
export const revalidate = 3600;

const MAX_PLAYERS = 5000;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getAppUrl();
  const entries: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    { url: `${base}/players`, changeFrequency: "hourly", priority: 0.8 },
    { url: `${base}/leaderboards`, changeFrequency: "hourly", priority: 0.8 },
    { url: `${base}/matches`, changeFrequency: "hourly", priority: 0.6 },
    { url: `${base}/rules`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${base}/privacy`, changeFrequency: "monthly", priority: 0.2 },
  ];

  // Public profiles: the read policy only exposes approved members, so this lists exactly those.
  const db = createSupabasePublicClient();
  if (db) {
    const { data } = await db
      .from("chess_account_links")
      .select("chess_username")
      .order("chess_username")
      .limit(MAX_PLAYERS);
    for (const row of data ?? []) {
      entries.push({
        url: `${base}/players/${row.chess_username}`,
        changeFrequency: "daily",
        priority: 0.5,
      });
    }
  }
  return entries;
}
