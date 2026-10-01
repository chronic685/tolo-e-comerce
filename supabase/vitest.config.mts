import { defineConfig } from "vitest/config";

// Every test under supabase/ is database-free: Edge Function decision
// logic runs with all I/O injected/mocked, and migration tests run the real
// SQL against an in-process PGlite Postgres (tests/pglite/harness.ts) --
// never against a live or even a local Supabase. Deliberately its own
// config, not the repo root's "backend" project, whose globalSetup opens a
// connection to a real Supabase instance.
export default defineConfig({
  test: {
    name: "supabase",
    root: import.meta.dirname,
    environment: "node",
    include: ["functions/**/*.test.ts", "tests/**/*.test.ts"],
    // PGlite boots a whole Postgres per test file.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
