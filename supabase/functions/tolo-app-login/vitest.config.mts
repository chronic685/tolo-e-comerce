import { defineConfig } from "vitest/config";

// This edge function's own tests exercise pure logic (logic.ts, phone.ts)
// with every I/O dependency injected/mocked -- they never touch a
// database. Deliberately its own config, not the repo root's
// vitest.config.mts, whose globalSetup opens a connection to a real
// (local-in-CI or live-locally) Supabase instance for the backend
// regression suite.
export default defineConfig({
  test: {
    environment: "node",
    include: ["*.test.ts"],
  },
});
