"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[ui] unhandled error", error.digest ?? error.message);
  }, [error]);
  return (
    <main
      id="main"
      className="mx-auto grid min-h-[60dvh] max-w-lg content-center justify-items-center gap-5 px-4 text-center"
    >
      <h1 className="font-display text-4xl">Something went wrong</h1>
      <p className="text-muted-foreground">
        An unexpected error stopped this page from loading. It has been logged. You can try again.
      </p>
      {error.digest ? (
        <p className="font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>
      ) : null}
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
