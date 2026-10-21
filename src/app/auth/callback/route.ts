import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Only same-site relative paths are honoured; anything else could be an open redirect. */
function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/dashboard";
  return value;
}

/**
 * OAuth landing point. Exchanges the one-time code for a session (PKCE), then checks the
 * student allowlist before sending the user on. Failures go to a friendly error page.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const fail = (reason: string) => NextResponse.redirect(new URL(`/auth/error?reason=${encodeURIComponent(reason)}`, url));

  if (url.searchParams.get("error")) return fail(url.searchParams.get("error") === "access_denied" ? "access_denied" : "provider_error");
  const code = url.searchParams.get("code");
  if (!code) return fail("missing_code");

  const supabase = await createSupabaseServerClient();
  if (!supabase) return fail("not_configured");
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return fail("exchange_failed");

  // First login (or an allowlist change since): match the verified Google email. Never blocks sign-in.
  await supabase.rpc("claim_eligibility");
  return NextResponse.redirect(new URL(safeNext(url.searchParams.get("next")), url));
}
