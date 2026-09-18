import { beforeAll, describe, expect, inject, it } from "vitest";
import { env, signIn } from "../env.ts";
import { callFunction } from "../helpers.ts";

// Tenant isolation between two unrelated merchants — the highest-value
// authorization property in the platform. Uses the QA fixture merchant_order
// (owned by QA Merchant A, permanently left in "new" status) so these tests
// stay repeatable: every case here is either read-only or an action that
// must be REJECTED, so nothing here changes the fixture's state between runs.
//
// D1 ("Merchant A can act on their own order and it succeeds") is
// deliberately NOT exercised end-to-end here: order-status transitions are
// one-way, so a real success call would permanently advance the fixture out
// of "new" and break every other test in this file on the next run. That
// happy path is covered by manual QA (see tests/README.md) rather than
// automated CI, until a disposable per-run order or a reset mechanism
// exists (see tests/README.md, "known gaps"). Read access for the rightful
// owner (RLS, not this test) is asserted instead, alongside the rejection
// cases, which fully exercise the isolation boundary itself.
async function readMerchantOrderAsUser(token: string, merchantOrderId: string): Promise<unknown[]> {
  const res = await fetch(`${env.supabaseUrl}/rest/v1/merchant_orders?id=eq.${merchantOrderId}&select=id,status,merchant_id`, {
    headers: { apikey: env.anonKey, Authorization: `Bearer ${token}` },
  });
  return res.json();
}

describe("merchant tenant isolation", () => {
  let merchantAToken: string;
  let merchantBToken: string;

  beforeAll(async () => {
    merchantAToken = await signIn(env.qaMerchantAEmail, env.qaMerchantAPassword);
    merchantBToken = await signIn(env.qaMerchantBEmail, env.qaMerchantBPassword);
  });

  it("D1: the owning merchant (A) can read their own order via RLS", async () => {
    const fixtures = inject("qaFixtures");
    const rows = await readMerchantOrderAsUser(merchantAToken, fixtures.merchantOrderId);
    expect(rows).toHaveLength(1);
  });

  it("D2: an unrelated merchant (B) cannot read merchant A's order — RLS returns zero rows, not an error", async () => {
    const fixtures = inject("qaFixtures");
    const rows = await readMerchantOrderAsUser(merchantBToken, fixtures.merchantOrderId);
    expect(rows).toHaveLength(0);
  });

  it("D3: an unrelated merchant (B) cannot transition merchant A's order — 403, no state change", async () => {
    const fixtures = inject("qaFixtures");
    const res = await callFunction("order-status", {
      token: merchantBToken,
      body: { merchant_order_id: fixtures.merchantOrderId, status: "accepted" },
    });
    expect(res.status).toBe(403);

    // Confirm the rejection really did nothing — status must still be "new".
    const rows = (await readMerchantOrderAsUser(merchantAToken, fixtures.merchantOrderId)) as { status: string }[];
    expect(rows[0]?.status).toBe("new");
  });

  it("D4: an unauthenticated caller cannot transition any order — 401, no state change", async () => {
    const fixtures = inject("qaFixtures");
    const res = await callFunction("order-status", {
      body: { merchant_order_id: fixtures.merchantOrderId, status: "accepted" },
    });
    expect(res.status).toBe(401);

    const rows = (await readMerchantOrderAsUser(merchantAToken, fixtures.merchantOrderId)) as { status: string }[];
    expect(rows[0]?.status).toBe("new");
  });
});
