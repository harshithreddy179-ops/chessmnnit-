import "server-only";

import { ChessComClient, buildUserAgent } from "@/lib/chess/client";
import { getAppUrl } from "@/lib/env";
import { getChessComConfig } from "@/lib/env.server";

let shared: ChessComClient | null = null;

/**
 * One process-wide client, so every outgoing Chess.com request in this server instance
 * goes through the same serial queue and pacing.
 */
export function getChessClient(): ChessComClient {
  if (shared) return shared;
  const config = getChessComConfig();
  shared = new ChessComClient({
    userAgent: buildUserAgent(getAppUrl(), config.contact),
    minIntervalMs: config.minRequestIntervalMs,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
  });
  return shared;
}
