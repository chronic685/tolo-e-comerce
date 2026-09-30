import { defineConfig } from "vitest/config";

// Deliberately its own config, not an extension of the repo root's
// vitest.config.mts — that one's globalSetup opens a connection to a real
// (local-in-CI or live-locally) Supabase instance for the backend
// regression suite. Merchant-dashboard unit tests must never touch the
// database, so they get a plain jsdom environment and nothing else (same
// split as frontend/vitest.config.ts).
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./src/test-setup.ts"],
    globals: true,
  },
});
