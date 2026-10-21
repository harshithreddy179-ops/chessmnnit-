"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPublicSupabaseConfig } from "@/lib/env";
import type { Database } from "@/lib/database.types";

let client: SupabaseClient<Database> | null = null;

/** Browser Supabase client (publishable key only). Returns null when not configured. */
export function getBrowserSupabase(): SupabaseClient<Database> | null {
  if (client) return client;
  const config = getPublicSupabaseConfig();
  if (!config) return null;
  client = createBrowserClient<Database>(config.url, config.key);
  return client;
}
