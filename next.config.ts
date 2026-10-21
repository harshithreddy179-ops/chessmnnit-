import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Hosts the browser is allowed to talk to. The Supabase host is derived from
 * the configured project URL so the CSP stays tight in production; when the
 * variable is missing at build time we fall back to the generic Supabase wildcard.
 */
function supabaseOrigins(): { http: string; ws: string } {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  try {
    if (raw) {
      const url = new URL(raw);
      return { http: url.origin, ws: `${url.protocol === "http:" ? "ws" : "wss"}://${url.host}` };
    }
  } catch {
    // fall through to wildcard
  }
  return { http: "https://*.supabase.co", ws: "wss://*.supabase.co" };
}

const supabase = supabaseOrigins();
const localSupabase = isDev ? " http://127.0.0.1:54321 ws://127.0.0.1:54321" : "";

const contentSecurityPolicy = [
  "default-src 'self'",
  // Next.js injects inline bootstrap scripts; nonce-based CSP would force every
  // page to be dynamic, so inline scripts are allowed while remote scripts are not.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://images.chesscomfiles.com https://*.chesscomfiles.com",
  "font-src 'self' data:",
  `connect-src 'self' ${supabase.http} ${supabase.ws}${localSupabase}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // The classic (pre Cache Components) rendering model is used on purpose:
  // almost every page depends on the signed-in user, so request-time rendering
  // is the default and public data is cached explicitly with `unstable_cache`.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
