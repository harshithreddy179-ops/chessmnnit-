import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicSupabaseConfig } from "@/lib/env";

export interface ProxySession {
  response: NextResponse;
  /** Verified JWT claims for the request, or null when signed out / not configured. */
  userId: string | null;
  configured: boolean;
}

/**
 * Refreshes the Supabase session cookies for the incoming request and reports who is
 * signed in. `getClaims()` verifies the JWT signature against the project's published
 * signing keys, so a forged cookie cannot pass. Pages and route handlers still call
 * `getUser()` (a round-trip to Auth) before doing anything sensitive.
 */
export async function refreshSession(request: NextRequest): Promise<ProxySession> {
  const config = getPublicSupabaseConfig();
  let response = NextResponse.next({ request });
  if (!config) return { response, userId: null, configured: false };

  const supabase = createServerClient(config.url, config.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet)
          response.cookies.set(name, value, options);
      },
    },
  });

  try {
    const { data } = await supabase.auth.getClaims();
    const sub = data?.claims?.sub;
    return { response, userId: typeof sub === "string" ? sub : null, configured: true };
  } catch {
    return { response, userId: null, configured: true };
  }
}
