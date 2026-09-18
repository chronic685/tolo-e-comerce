import type { TestProject } from "vitest/node";
import { ensureQaFixtures, type QaFixtures } from "./fixtures/ensureQaFixtures.ts";

declare module "vitest" {
  export interface ProvidedContext {
    qaFixtures: QaFixtures;
  }
}

// Runs once for the whole `vitest run`, not per file/test — this is where
// the one-time, idempotent QA fixture provisioning happens (see
// ensureQaFixtures.ts for why fixtures live in the real project instead of
// an isolated test database).
export default async function setup(project: TestProject) {
  const fixtures = await ensureQaFixtures();
  project.provide("qaFixtures", fixtures);
}
