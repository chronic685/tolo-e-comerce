import { defineConfig } from "vitest/config";

// Deliberately its own config, not the repo root's vitest.config.mts, whose
// globalSetup opens a connection to a real (local-in-CI or live-locally)
// Supabase instance for the backend regression suite. Pagination and
// usePagination are pure UI -- these tests get a plain jsdom environment
// and never touch a database.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./src/test-setup.ts"],
    // @testing-library/react's auto-cleanup-after-each-test registers
    // against the global afterEach -- without this, renders from earlier
    // tests in the same file pile up in the jsdom document instead of
    // unmounting.
    globals: true,
  },
});
