"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { api, ApiClientError } from "@/lib/api-client";

/** Runs an API call with busy/error state, a success toast and a server-data refresh. */
export function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiClientError | null>(null);

  const run = useCallback(
    async <T>(
      key: string,
      path: string,
      options: { method?: string; body?: unknown; success?: string; refresh?: boolean } = {},
    ): Promise<T | null> => {
      setBusy(key);
      setError(null);
      try {
        const data = await api<T>(path, { method: options.method, body: options.body });
        if (options.success) toast.success(options.success);
        if (options.refresh !== false) router.refresh();
        return data;
      } catch (e) {
        const err =
          e instanceof ApiClientError
            ? e
            : new ApiClientError(0, "error", "Something went wrong. Please try again.");
        setError(err);
        return null;
      } finally {
        setBusy(null);
      }
    },
    [router],
  );

  return { run, busy, error, clearError: () => setError(null) };
}
