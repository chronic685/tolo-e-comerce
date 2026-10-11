import { defineConfig } from "vitest/config";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { assertLocalSupabaseUrl } from "./tests/localGuard.ts";

// Local dev: tests/.env.test (gitignored). CI: real environment/secrets are
// injected directly, no file needed — see .github/workflows/ci.yml.
const localEnvFile = resolve(import.meta.dirname, "tests/.env.test");
if (existsSync(localEnvFile)) {
  process.loadEnvFile(localEnvFile);
}

// The "backend" project talks to a Supabase and creates data in it, so it needs a LOCAL one (docs/development-guidelines.md, rule 1):
//  - SUPABASE_URL unset: the project is skipped, with a message, so `npm test` still runs everything that is database-free.
//  - SUPABASE_URL set to anything but localhost/127.0.0.1: the run stops here, before any test or fixture touches it.
const supabaseUrl = process.env.SUPABASE_URL;
const runBackendTests = Boolean(supabaseUrl);
if (supabaseUrl) assertLocalSupabaseUrl(supabaseUrl);
else
  console.warn(
    "[tests] SUPABASE_URL is not set: skipping the backend (Supabase) tests. To run them, start a local Supabase " +
      "(`npx supabase start`, `npx supabase status -o env`) and put its URL and keys in tests/.env.test. See tests/README.md.",
  );

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
          // Skipped without a local Supabase; globalSetup is dropped too, since it provisions fixtures in the database.
          include: runBackendTests ? ["tests/smoke/**/*.test.ts", "tests/unit/**/*.test.ts"] : [],
          globalSetup: runBackendTests ? ["./tests/globalSetup.ts"] : [],
          passWithNoTests: true,
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
      // The guard that keeps the backend project off non-local databases: database-free, always runs.
      {
        extends: true,
        test: { name: "test-guard", environment: "node", include: ["tests/guard/**/*.test.ts"] },
      },
      // Auto-discovers frontend/vitest.config.ts (jsdom).
      "frontend",
      // Auto-discovers packages/ui/vitest.config.mts (jsdom) -- without this,
      // @tolo/ui's own tests (e.g. Pagination.test.tsx) are never picked up
      // by root `vitest run` / `npm test` at all.
      "packages/ui",
      // The typed client for the new C# API: pure TypeScript, mocked fetch.
      "packages/api-client",
      // merchant-dashboard and admin-dashboard gained their own jsdom
      // vitest configs (feat/advanced-ui) -- same reason as "frontend"
      // above: without registering them here, root `vitest run` / `npm
      // test` (CI's only test step) silently never runs their tests at all.
      "merchant-dashboard",
      "admin-dashboard",
      // Edge Function logic + migration (PGlite) tests -- database-free, see
      // supabase/vitest.config.mts.
      "supabase/vitest.config.mts",
    ],
  },
});
