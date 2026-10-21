import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ApiError, assertSameOrigin } from "@/server/api";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
  } catch (error) {
    if (error instanceof ApiError) return new NextResponse("Forbidden", { status: 403 });
    throw error;
  }
  const supabase = await createSupabaseServerClient();
  await supabase?.auth.signOut();
  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}
