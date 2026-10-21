import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";
import { appEnv, appUrl, E2E } from "./tests/e2e/env";

// Use the system / pre-installed Chromium when present (no browser download needed).
const chromium = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  // One worker: the specs share one database and one fake Chess.com.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: appUrl,
    launchOptions: { executablePath: chromium, args: ["--no-sandbox"] },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      // Migrated database + Supabase stand-in.
      command: "npx tsx tests/e2e/servers.ts",
      port: E2E.supabasePort,
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      // The real application: production build, started against the stand-in.
      command: `npx next build && npx next start -p ${E2E.appPort}`,
      url: `${appUrl}/rules`,
      timeout: 360_000,
      reuseExistingServer: false,
      env: appEnv,
    },
  ],
});
