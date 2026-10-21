"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getBrowserSupabase } from "@/lib/supabase/client";

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.200 3.5-8.800Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.200 0 6-1.100 7.900-2.900l-3.900-3c-1.100.7-2.500 1.200-4 1.200-3.100 0-5.700-2.100-6.600-4.900H1.400v3.100A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.400 14.400a7.200 7.200 0 0 1 0-4.800V6.500H1.400a12 12 0 0 0 0 11l4-3.100Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.800c1.800 0 3.300.6 4.600 1.800l3.400-3.400A12 12 0 0 0 1.400 6.500l4 3.100C6.300 6.900 8.900 4.800 12 4.800Z"
      />
    </svg>
  );
}

/** Safe relative path only; anything else would be an open redirect. */
function safeNext(next: string | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\")
    ? next
    : "/dashboard";
}

export function LoginPanel({ configured, next }: { configured: boolean; next?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = async () => {
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNext(next))}`,
        queryParams: { prompt: "select_account" },
      },
    });
    if (err) {
      setBusy(false);
      setError("Google sign-in could not be started. Please try again.");
    }
  };

  return (
    <Card>
      <CardContent className="grid gap-4 p-6">
        {!configured ? (
          <Alert variant="warning" title="Sign-in is awaiting configuration">
            This deployment has no Supabase project connected yet. An administrator needs to set the
            Supabase environment variables and enable the Google provider (see the setup guide).
          </Alert>
        ) : null}
        {error ? <Alert variant="danger">{error}</Alert> : null}
        <Button size="lg" onClick={signIn} loading={busy} disabled={!configured} className="w-full">
          <GoogleMark /> Continue with Google
        </Button>
      </CardContent>
    </Card>
  );
}
