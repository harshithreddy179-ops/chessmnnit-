import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { one, type RawSearchParams } from "@/lib/search-params";

export const metadata: Metadata = { title: "Sign-in problem", robots: { index: false } };

const REASONS: Record<string, string> = {
  access_denied: "You cancelled the Google sign-in, or Google denied access.",
  exchange_failed: "The sign-in link expired or was already used. Please start again.",
  missing_code: "The sign-in response from Google was incomplete. Please start again.",
  provider_error: "Google reported a problem while signing you in. Please try again.",
  not_configured: "Sign-in is not configured for this deployment yet.",
};

export default async function AuthErrorPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const reason = one((await searchParams).reason) ?? "";
  return (
    <main id="main" className="mx-auto grid min-h-dvh max-w-md content-center gap-6 px-4">
      <Brand />
      <h1 className="font-display text-4xl">We couldn’t sign you in</h1>
      <Alert variant="danger">{REASONS[reason] ?? "Something went wrong during sign-in. Please try again."}</Alert>
      <div className="flex gap-3">
        <Button asChild><Link href="/login">Try again</Link></Button>
        <Button asChild variant="outline"><Link href="/">Back to home</Link></Button>
      </div>
    </main>
  );
}
