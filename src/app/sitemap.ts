import type { MetadataRoute } from "next";
import { getAppUrl } from "@/lib/env";
import { getSitemapPlayers } from "@/server/data/public";

// Rendered per request (and cached briefly inside getSitemapPlayers) so a build without database
// access can never freeze an empty player list into the sitemap.
export const dynamic = "force-dynamic";

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
  for (const username of await getSitemapPlayers()) {
    entries.push({ url: `${base}/players/${username}`, changeFrequency: "daily", priority: 0.5 });
  }
  return entries;
}
