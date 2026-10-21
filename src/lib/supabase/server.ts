import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getPublicSupabaseConfig } from "@/lib/env";
import { getSupabaseSecretKey } from "@/lib/env.server";
import type { Database } from "@/lib/database.types";

export type Db = SupabaseClient<Database>;

/**
 * Supabase client bound to the signed-in user's session cookies. All queries run under
 * the user's JWT and are therefore subject to Row Level Security.
 */
export async function createSupabaseServerClient(): Promise<Db | null> {
  // Read the request cookies BEFORE looking at configuration. This opts every caller into
  // request-time rendering no matter what the environment looked like at build time;
  // otherwise a build without env vars would prerender the signed-out state and serve it
  // forever once the variables are provided at runtime.
  const cookieStore = await cookies();
  const config = getPublicSupabaseConfig();
  if (!config) return null;
  return createServerClient<Database>(config.url, config.key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only. The proxy
          // refreshes the session on every request, so this is safe to ignore.
        }
      },
    },
  });
}

/**
 * Cookie-less anonymous client for public, cacheable reads (leaderboards, landing page).
 * It never carries a user session, so results are identical for every visitor.
 */
export function createSupabasePublicClient(): Db | null {
  const config = getPublicSupabaseConfig();
  if (!config) return null;
  return createClient<Database>(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * Service-role client. BYPASSES RLS. Restricted to trusted server code: cron jobs,
 * verification confirmation, account deletion. Never expose it to a request without
 * first authenticating and authorizing the caller yourself.
 */
export function createSupabaseAdminClient(): Db | null {
  const config = getPublicSupabaseConfig();
  const secret = getSupabaseSecretKey();
  if (!config || !secret) return null;
  return createClient<Database>(config.url, secret, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
