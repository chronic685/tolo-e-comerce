import { beforeAll, describe, expect, inject, it } from "vitest";
import { env, serviceClient, signIn } from "../env.ts";
import { callFunction } from "../helpers.ts";

// Tenant isolation between two unrelated merchants — the highest-value
// authorization property in the platform. Uses the QA fixture merchant_order
// (owned by QA Merchant A, permanently left in "new" status) so the D2/D3/D4
// rejection cases stay repeatable: every one of them is read-only or an
// action that must be REJECTED, so nothing changes the fixture's state
// between runs.
//
// D1 ("Merchant A can act on their own order and it succeeds") instead uses
// its own disposable, per-test order created via create_order() — the real
// checkout path, not a direct insert — specifically because order-status
// transitions are one-way and a real success call against the shared
// fixture order would permanently advance it out of "new", breaking D2/D3/D4
// on every subsequent run. Read access for the rightful owner (RLS, not the
// transition itself) is still asserted against the shared fixture order,
// alongside the rejection cases, which fully exercise the isolation boundary.
const db = serviceClient();

async function readMerchantOrderAsUser(token: string, merchantOrderId: string): Promise<unknown[]> {
  const res = await fetch(`${env.supabaseUrl}/rest/v1/merchant_orders?id=eq.${merchantOrderId}&select=id,status,merchant_id`, {
    headers: { apikey: env.anonKey, Authorization: `Bearer ${token}` },
  });
  return res.json();
}

async function createDisposableOrder(customerUserId: string, addressId: string, variantId: string): Promise<string> {
  const { data: orderId, error } = await db.rpc("create_order", {
    p_customer_id: customerUserId,
    p_address_id: addressId,
    p_items: [{ variant_id: variantId, quantity: 1 }],
  });
  if (error) throw error;
  const { data: mo, error: moError } = await db.from("merchant_orders").select("id").eq("order_id", orderId as string).single();
  if (moError) throw moError;
  return mo.id as string;
}

describe("merchant tenant isolation", () => {
  let merchantAToken: string;
  let merchantBToken: string;

  beforeAll(async () => {
    merchantAToken = await signIn(env.qaMerchantAEmail, env.qaMerchantAPassword);
    merchantBToken = await signIn(env.qaMerchantBEmail, env.qaMerchantBPassword);
  });

  it("D1: the owning merchant (A) can accept their own new order — the full transition succeeds", async () => {
    const fixtures = inject("qaFixtures");
    const merchantOrderId = await createDisposableOrder(fixtures.customerUserId, fixtures.addressId, fixtures.variantId);

    const res = await callFunction("order-status", {
      token: merchantAToken,
      body: { merchant_order_id: merchantOrderId, status: "accepted" },
    });
    expect(res.status).toBe(200);

    const { data: mo, error } = await db
      .from("merchant_orders")
      .select("status, order_received_at, received_by")
      .eq("id", merchantOrderId)
      .single();
    expect(error).toBeNull();
    expect(mo!.status).toBe("accepted");
    expect(mo!.order_received_at).not.toBeNull();
    expect(mo!.received_by).toBe(fixtures.merchantAUserId);

    // Leave the disposable order in a terminal state rather than dangling
    // "accepted" forever — same cleanup convention as the other Phase 5c/5d
    // disposable-order tests — and confirm the shared fixture order (used
    // by D2/D3/D4 below) was never touched by any of this.
    await db.rpc("release_stock", { p_variant_id: fixtures.variantId, p_quantity: 1, p_reference_id: merchantOrderId, p_as_sale: false });
    await db.from("merchant_orders").update({ status: "cancelled" }).eq("id", merchantOrderId);

    const fixtureRows = (await readMerchantOrderAsUser(merchantAToken, fixtures.merchantOrderId)) as { status: string }[];
    expect(fixtureRows[0]?.status).toBe("new");
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
