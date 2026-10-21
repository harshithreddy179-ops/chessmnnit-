"use client";

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: { path: string; message: string }[] = [],
  ) {
    super(message);
    this.name = "ApiClientError";
  }
  /** Message for a specific form field, when the server reported one. */
  fieldError(path: string): string | undefined {
    return this.fields.find((f) => f.path === path)?.message;
  }
}

/**
 * Calls one of this app's JSON routes. Resolves with the `data` payload; rejects with an
 * ApiClientError whose message is already phrased for people (never a raw database error).
 */
export async function api<T = unknown>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: options.method ?? "POST",
      headers: { "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: "same-origin",
    });
  } catch {
    throw new ApiClientError(0, "network", "You appear to be offline. Check your connection and try again.");
  }
  let payload: { ok?: boolean; data?: T; error?: { code?: string; message?: string; fields?: { path: string; message: string }[] } } = {};
  try {
    payload = await res.json();
  } catch {
    // fall through with an empty payload
  }
  if (!res.ok || payload.ok === false) {
    throw new ApiClientError(
      res.status,
      payload.error?.code ?? "error",
      payload.error?.message ?? "Something went wrong. Please try again.",
      payload.error?.fields,
    );
  }
  return payload.data as T;
}
