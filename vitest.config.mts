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
    globalSetup: ["./tests/globalSetup.ts"],
    // Every test in this suite talks to the real deployed Supabase project
    // over the network (there is no local/offline Supabase available in
    // this environment — see tests/README.md) — allow enough time for that.
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // Vitest runs test files in worker processes that don't inherit changes
    // made to process.env by this config file — pass it through explicitly.
    env: process.env,
  },
});
