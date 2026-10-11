import { defineConfig } from "vitest/config";

// Its own config, like packages/ui: pure TypeScript tests with a mocked fetch. Never a database, never the network.
export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
