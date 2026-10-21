import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const alias = {
  "@": fileURLToPath(new URL("./src", import.meta.url)),
  // `server-only` throws outside a React Server build; tests run in plain Node.
  "server-only": fileURLToPath(new URL("./tests/helpers/server-only-stub.ts", import.meta.url)),
};

export default defineConfig({
  resolve: { alias },
  test: {
    environment: "node",
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "db",
          include: ["tests/db/**/*.test.ts"],
          globalSetup: ["tests/db/global-setup.ts"],
          // Each file gets its own database cloned from a migrated template, but the
          // admin connection that clones it is shared, so run files one at a time.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
