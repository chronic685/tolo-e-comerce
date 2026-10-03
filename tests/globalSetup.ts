import type { TestProject } from "vitest/node";
import { ensureQaFixtures, type QaFixtures } from "./fixtures/ensureQaFixtures.ts";
import { env, serviceClient, signInFresh, tokenKey } from "./env.ts";

declare module "vitest" {
  export interface ProvidedContext {
    qaFixtures: QaFixtures;
    /** One access token per QA account, signed in once for the whole run
     * (see env.ts signIn), keyed by tokenKey(email, password). */
    qaTokens: Record<string, string>;
  }
}

/** Every order that has a merchant order on an is_test merchant (the QA fixtures). */
async function qaOrderIds(db: ReturnType<typeof serviceClient>): Promise<Set<string>> {
  const ids = new Set<string>();
  // PostgREST caps a response at max_rows (1000), so page through it.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("merchant_orders")
      .select("order_id, merchants!inner(is_test)")
      .eq("merchants.is_test", true)
      .order("id")
      .range(from, from + 999);
    if (error) throw error;
    for (const row of data) ids.add(row.order_id as string);
    if (data.length < 1000) break;
  }
  return ids;
}

// Runs once for the whole `vitest run`, not per file/test — this is where
// the one-time, idempotent QA fixture provisioning happens (see
// ensureQaFixtures.ts for why fixtures live in the real project instead of
// an isolated test database), the QA accounts sign in, and -- on the way out
// -- the orders this run created are removed again.
export default async function setup(project: TestProject) {
  const fixtures = await ensureQaFixtures();
  project.provide("qaFixtures", fixtures);

  const accounts: [string, string][] = [
    [env.qaMerchantAEmail, env.qaMerchantAPassword],
    [env.qaMerchantBEmail, env.qaMerchantBPassword],
    [env.qaCustomerEmail, env.qaCustomerPassword],
    [env.qaStaffEmail, env.qaStaffPassword],
  ];
  const tokens: Record<string, string> = {};
  for (const [email, password] of accounts) tokens[tokenKey(email, password)] = await signInFresh(email, password);
  project.provide("qaTokens", tokens);

  const db = serviceClient();
  const orderIdsBefore = await qaOrderIds(db);

  // The suite creates a few hundred real orders per run (there is no test
  // database). Left alone they were 3,196 of the live project's 3,200 orders.
  // Remove what THIS run added, through delete_qa_orders() (migration 0083),
  // which only ever touches orders of is_test merchants and skips any order
  // something else has come to refer to (a settlement, a review, ...).
  return async function teardown() {
    try {
      const keep = new Set(orderIdsBefore);
      // The fixture orders other runs rely on.
      const { data: fixtureOrders } = await db
        .from("merchant_orders")
        .select("order_id")
        .in("id", [fixtures.merchantOrderId, fixtures.reviewableMerchantOrderId]);
      for (const row of fixtureOrders ?? []) keep.add(row.order_id as string);

      const created = [...(await qaOrderIds(db))].filter((id) => !keep.has(id));
      let deleted = 0;
      let skipped = 0;
      for (let i = 0; i < created.length; i += 100) {
        const { data, error } = await db.rpc("delete_qa_orders", { p_order_ids: created.slice(i, i + 100), p_skip_ineligible: true }).single();
        if (error) throw error;
        const row = data as { orders_deleted: number; orders_skipped: number };
        deleted += row.orders_deleted;
        skipped += row.orders_skipped;
      }

      // What the run's notifications left behind for the QA accounts; nothing
      // reads another run's notifications.
      await db
        .from("notifications")
        .delete()
        .in("user_id", [fixtures.customerUserId, fixtures.merchantAUserId, fixtures.merchantBUserId, fixtures.staffUserId]);

      console.log(`[teardown] removed ${deleted} test orders this run created (${skipped} kept because something refers to them).`);
    } catch (err) {
      // Never fail the run over cleanup; the next run's teardown won't see these
      // (they predate its snapshot), so say so loudly.
      console.warn("[teardown] cleanup of this run's test orders failed:", err instanceof Error ? err.message : err);
    }
  };
}
