import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient, type Db } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

export type AppRole = Database["public"]["Enums"]["app_role"];
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type ProfileSettings = Database["public"]["Tables"]["profile_settings"]["Row"];
export type ChessLink = Database["public"]["Tables"]["chess_account_links"]["Row"];

export interface SessionUser {
  id: string;
  email: string | null;
}

/**
 * The signed-in user, verified with Supabase Auth (a round trip), not merely decoded from
 * a cookie. Memoised per request.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
});

export interface AppContext {
  supabase: Db;
  user: SessionUser;
  profile: Profile;
  settings: ProfileSettings | null;
  link: ChessLink | null;
  roles: AppRole[];
}

/** Everything about the signed-in player, read through RLS (so only their own rows). */
export const getAppContext = cache(async (): Promise<AppContext | null> => {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const user = await getSessionUser();
  if (!user) return null;

  const [profile, settings, link, roles] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase.from("profile_settings").select("*").eq("user_id", user.id).maybeSingle(),
    supabase.from("chess_account_links").select("*").eq("user_id", user.id).maybeSingle(),
    supabase.from("admin_roles").select("role").eq("user_id", user.id),
  ]);
  if (!profile.data) return null;
  return {
    supabase,
    user,
    profile: profile.data,
    settings: settings.data,
    link: link.data,
    roles: (roles.data ?? []).map((r) => r.role),
  };
});

/** Page-level guard: signed-in users only. */
export async function requireContext(next?: string): Promise<AppContext> {
  const ctx = await getAppContext();
  if (!ctx) redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  return ctx;
}

/** Page-level guard for the main app: also requires finished onboarding. */
export async function requireOnboarded(next?: string): Promise<AppContext> {
  const ctx = await requireContext(next);
  if (!ctx.profile.onboarding_completed_at) redirect("/onboarding");
  return ctx;
}

/**
 * Page-level guard for administrator pages. Roles come from the database
 * (admin_roles, via RLS), never from the request. The database re-checks on every write.
 */
export async function requireAdmin(allowed?: AppRole[]): Promise<AppContext> {
  const ctx = await requireContext("/admin");
  const ok =
    ctx.roles.length > 0 &&
    (!allowed || ctx.roles.includes("super_admin") || ctx.roles.some((r) => allowed.includes(r)));
  if (!ok) redirect("/dashboard");
  return ctx;
}

export function isApproved(profile: Profile): boolean {
  return profile.is_approved;
}
