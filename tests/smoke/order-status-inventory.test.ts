import { beforeAll, describe, expect, inject, it } from "vitest";
import { env, serviceClient, signIn } from "../env.ts";
import { callFunction } from "../helpers.ts";

// Phase 5a, item 1: order-status must release reserved inventory when an
// order is rejected or cancelled (release_stock(..., p_as_sale=false)) —
// otherwise reserved_quantity, and therefore the generated
// available_quantity, stays permanently inflated for stock that was never
// actually sold. Uses disposable orders against the shared QA product
// (fixtures.variantId) and asserts on the *delta*, since that product
// already carries a permanent reservation from the "new"-status tenant
// isolation fixture (see tests/README.md) — the baseline is never 0.
const db = serviceClient();

async function getReservedQuantity(variantId: string): Promise<number> {
  const { data, error } = await db.from("inventory").select("reserved_quantity").eq("variant_id", variantId).single();
  if (error) throw error;
  return data.reserved_quantity;
}

async function createDisposableOrder(customerUserId: string, addressId: string, variantId: string, quantity: number) {
  const { data: orderId, error } = await db.rpc("create_order", {
    p_customer_id: customerUserId,
    p_address_id: addressId,
    p_items: [{ variant_id: variantId, quantity }],
  });
  if (error) throw error;
  const { data: mo, error: moError } = await db.from("merchant_orders").select("id").eq("order_id", orderId as string).single();
  if (moError) throw moError;
  return { orderId: orderId as string, merchantOrderId: mo.id as string };
}

describe("order-status: releases reserved inventory on reject/cancel", () => {
  let merchantAToken: string;
  let addressId: string;
  let variantId: string;
  let customerUserId: string;

  beforeAll(async () => {
    merchantAToken = await signIn(env.qaMerchantAEmail, env.qaMerchantAPassword);
    const fixtures = inject("qaFixtures");
    addressId = fixtures.addressId;
    variantId = fixtures.variantId;
    customerUserId = fixtures.customerUserId;
  });

  it("releases reserved stock (and logs it) when a brand-new order is rejected", async () => {
    const before = await getReservedQuantity(variantId);
    const { orderId, merchantOrderId } = await createDisposableOrder(customerUserId, addressId, variantId, 2);

    expect(await getReservedQuantity(variantId)).toBe(before + 2);

    const res = await callFunction("order-status", {
      token: merchantAToken,
      body: { merchant_order_id: merchantOrderId, status: "rejected" },
    });
    expect(res.status).toBe(200);

    expect(await getReservedQuantity(variantId)).toBe(before);

    const { data: movement } = await db
      .from("inventory_movements")
      .select("movement_type, quantity")
      .eq("variant_id", variantId)
      .eq("reference_id", orderId)
      .eq("movement_type", "release")
      .maybeSingle();
    expect(movement).not.toBeNull();
    expect(movement!.quantity).toBe(2);
  });

  it("releases reserved stock when an accepted order is later cancelled", async () => {
    const before = await getReservedQuantity(variantId);
    const { merchantOrderId } = await createDisposableOrder(customerUserId, addressId, variantId, 1);

    const acceptRes = await callFunction("order-status", {
      token: merchantAToken,
      body: { merchant_order_id: merchantOrderId, status: "accepted" },
    });
    expect(acceptRes.status).toBe(200);
    expect(await getReservedQuantity(variantId)).toBe(before + 1);

    const cancelRes = await callFunction("order-status", {
      token: merchantAToken,
      body: { merchant_order_id: merchantOrderId, status: "cancelled" },
    });
    expect(cancelRes.status).toBe(200);
    expect(await getReservedQuantity(variantId)).toBe(before);
  });

  it("a rejected/cancelled order cannot be transitioned again (no double-release path exists)", async () => {
    const { merchantOrderId } = await createDisposableOrder(customerUserId, addressId, variantId, 1);
    await callFunction("order-status", { token: merchantAToken, body: { merchant_order_id: merchantOrderId, status: "rejected" } });

    const secondAttempt = await callFunction("order-status", {
      token: merchantAToken,
      body: { merchant_order_id: merchantOrderId, status: "rejected" },
    });
    // MERCHANT_TRANSITIONS has no entry for "rejected" as a source status —
    // this must be rejected as an invalid transition, which is also what
    // structurally prevents release_stock from ever running twice for the
    // same order.
    expect(secondAttempt.status).toBe(400);
  });
});
