import type { MetadataRoute } from "next";
import { getAppUrl } from "@/lib/env";

export default function robots(): MetadataRoute.Robots {
  const base = getAppUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Member-only and operational areas have nothing for a search engine.
        disallow: [
          "/admin",
          "/api/",
          "/auth/",
          "/onboarding",
          "/dashboard",
          "/challenges",
          "/notifications",
          "/settings",
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
