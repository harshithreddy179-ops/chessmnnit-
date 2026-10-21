import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { LoginPanel } from "@/components/forms/login-panel";
import { isSupabaseConfigured } from "@/lib/env";
import { getSessionUser } from "@/server/auth";
import { one, type RawSearchParams } from "@/lib/search-params";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const sp = await searchParams;
  if (await getSessionUser()) redirect("/dashboard");
  return (
    <div className="mx-auto grid max-w-md gap-6 py-6">
      <div className="grid gap-2 text-center">
        <h1 className="font-display text-4xl">{one(sp.join) ? "Join MNNIT Chess" : "Welcome back"}</h1>
        <p className="text-sm text-muted-foreground">Sign in with Google. You will then confirm you are an MNNIT student and link your Chess.com account.</p>
      </div>
      <LoginPanel configured={isSupabaseConfigured()} next={one(sp.next)} />
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        We only receive your name and verified email from Google. Your email is never shown publicly, and we never ask for your Chess.com password.
      </p>
    </div>
  );
}
