import { NextResponse, type NextRequest } from "next/server";
import { refreshSession } from "@/lib/supabase/proxy-session";

/** Page prefixes that require a signed-in user. API routes authenticate themselves. */
const PROTECTED = ["/dashboard", "/challenges", "/notifications", "/settings", "/onboarding", "/admin"];

/**
 * Runs before every page request: keeps the Supabase session cookies fresh and gates the
 * member-only areas. This is a convenience layer. Pages and route handlers re-verify the
 * user and the database enforces every permission, so bypassing this proxy grants nothing.
 */
export async function proxy(request: NextRequest) {
  const { response, userId } = await refreshSession(request);
  const { pathname, search } = request.nextUrl;

  const isProtected = PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (isProtected && !userId) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(login);
  }
  if (pathname === "/login" && userId) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  return response;
}

export const config = {
  // Everything except Next internals, static assets and the cron/auth endpoints.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/cron|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
