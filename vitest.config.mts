import { defineConfig } from "vitest/config";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Local dev: tests/.env.test (gitignored). CI: real environment/secrets are
// injected directly, no file needed — see .github/workflows/ci.yml.
const localEnvFile = resolve(import.meta.dirname, "tests/.env.test");
if (existsSync(localEnvFile)) {
  process.loadEnvFile(localEnvFile);
}

export default defineConfig({
  test: {
    // Root `vitest run` (this repo's `npm test`, and CI's only test step)
    // used to have no include scope, so it swept up frontend/src/lib/
    // appBridge.test.ts and ran it under Node instead of the jsdom
    // environment frontend/vitest.config.ts declares. Splitting into
    // projects makes each side's own environment/include/globalSetup
    // actually apply.
    projects: [
      {
        extends: true,
        test: {
          name: "backend",
          environment: "node",
          include: ["tests/**/*.test.ts"],
          globalSetup: ["./tests/globalSetup.ts"],
          // Locally this suite talks to the real deployed Supabase project
          // over the network (no Docker here, see tests/README.md); CI
          // uses a local Supabase started in the runner. Allow enough time
          // for the network case.
          testTimeout: 20_000,
          hookTimeout: 30_000,
          // Vitest runs test files in worker processes that don't inherit
          // changes made to process.env by this config file — pass it
          // through explicitly.
          env: process.env,
          // Every test file shares one live database (see tests/README.md
          // — no isolated test DB exists here), so two files mutating the
          // same QA fixture row concurrently (e.g. commission_rules for
          // the QA merchant) can race each other. Running files
          // sequentially costs some wall-clock time but removes an entire
          // class of cross-file flakiness.
          fileParallelism: false,
        },
      },
      // Auto-discovers frontend/vitest.config.ts (jsdom).
      "frontend",
      // Auto-discovers packages/ui/vitest.config.mts (jsdom) -- without this,
      // @tolo/ui's own tests (e.g. Pagination.test.tsx) are never picked up
      // by root `vitest run` / `npm test` at all.
      "packages/ui",
      // merchant-dashboard and admin-dashboard gained their own jsdom
      // vitest configs (feat/advanced-ui) -- same reason as "frontend"
      // above: without registering them here, root `vitest run` / `npm
      // test` (CI's only test step) silently never runs their tests at all.
      "merchant-dashboard",
      "admin-dashboard",
    ],
  },
});
