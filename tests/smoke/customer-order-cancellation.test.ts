import { afterEach, beforeAll, describe, expect, inject, it } from "vitest";
import { env, serviceClient, signIn } from "../env.ts";
import { callFunction } from "../helpers.ts";

// Phase 5d, item 8: no customer-facing cancel action existed despite
// customer_features.order_cancellation_enabled being on by default. Adds a
// customer-authorized "new" -> "cancelled" transition to order-status,
// restricted to before merchant acceptance (see CUSTOMER_TRANSITIONS'
// comment in order-status/index.ts for why), gated by the same
// system_settings toggle FavoritesContext already reads for a different
// feature, and reusing the SAME release_stock reversal block item 1 added
// for merchant reject/cancel — not a separate mechanism.
const db = serviceClient();

async function createDisposableOrder(customerUserId: string, addressId: string, variantId: string) {
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

async function reservedQuantity(variantId: string): Promise<number> {
  const { data, error } = await db.from("inventory").select("reserved_quantity").eq("variant_id", variantId).single();
  if (error) throw error;
  return data.reserved_quantity as number;
}

describe("order-status: customer self-cancellation", () => {
  let customerToken: string;
  let merchantAToken: string;
  let merchantBToken: string;
  let addressId: string;
  let variantId: string;
  let customerUserId: string;

  beforeAll(async () => {
    customerToken = await signIn(env.qaCustomerEmail, env.qaCustomerPassword);
    merchantAToken = await signIn(env.qaMerchantAEmail, env.qaMerchantAPassword);
    merchantBToken = await signIn(env.qaMerchantBEmail, env.qaMerchantBPassword);
    const fixtures = inject("qaFixtures");
    addressId = fixtures.addressId;
    variantId = fixtures.variantId;
    customerUserId = fixtures.customerUserId;
  });

  it("lets the owning customer cancel a still-'new' order and releases the reservation", async () => {
    const merchantOrderId = await createDisposableOrder(customerUserId, addressId, variantId);
    const { data: moBefore } = await db.from("merchant_orders").select("order_id").eq("id", merchantOrderId).single();
    const orderId = moBefore!.order_id as string;
    const reservedBefore = await reservedQuantity(variantId);

    const res = await callFunction("order-status", {
      token: customerToken,
      body: { merchant_order_id: merchantOrderId, status: "cancelled" },
    });
    expect(res.status).toBe(200);

    const { data: mo, error } = await db.from("merchant_orders").select("status").eq("id", merchantOrderId).single();
    expect(error).toBeNull();
    expect(mo!.status).toBe("cancelled");

    // Same release_stock(..., p_as_sale: false) block item 1 wired up for
    // merchant reject/cancel — confirms this is that path, not a new one.
    expect(await reservedQuantity(variantId)).toBe(reservedBefore - 1);

    const { data: movement } = await db
      .from("inventory_movements")
      .select("movement_type")
      .eq("variant_id", variantId)
      .eq("reference_id", orderId)
      .eq("movement_type", "release")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    expect(movement).not.toBeNull();
  });

  it("rejects a different customer trying to cancel someone else's order", async () => {
    const merchantOrderId = await createDisposableOrder(customerUserId, addressId, variantId);
    // Merchant B's owner token stands in for "not the owning customer" —
    // any authenticated identity that isn't orders.customer_id must be
    // refused, same as the merchant-authorization branch already requires.
    const res = await callFunction("order-status", {
      token: merchantBToken,
      body: { merchant_order_id: merchantOrderId, status: "cancelled" },
    });
    expect(res.status).toBe(403);

    await callFunction("order-status", { token: merchantAToken, body: { merchant_order_id: merchantOrderId, status: "rejected" } });
  });

  it("refuses cancellation once the merchant has already accepted the order", async () => {
    // "accepted" -> "cancelled" is still a valid transition (the merchant's
    // own cancellation path), so this is a 403 authorization failure — the
    // customer isn't merchant staff/owner — not a 400 shape error. Only
    // "new" -> "cancelled" is in CUSTOMER_TRANSITIONS.
    const merchantOrderId = await createDisposableOrder(customerUserId, addressId, variantId);
    const acceptRes = await callFunction("order-status", {
      token: merchantAToken,
      body: { merchant_order_id: merchantOrderId, status: "accepted" },
    });
    expect(acceptRes.status).toBe(200);

    const res = await callFunction("order-status", {
      token: customerToken,
      body: { merchant_order_id: merchantOrderId, status: "cancelled" },
    });
    expect(res.status).toBe(403);

    await db.rpc("release_stock", { p_variant_id: variantId, p_quantity: 1, p_reference_id: merchantOrderId, p_as_sale: false });
    await db.from("merchant_orders").update({ status: "cancelled" }).eq("id", merchantOrderId);
  });

  describe("gated by customer_features.order_cancellation_enabled", () => {
    it("refuses cancellation when the setting is turned off", async () => {
      const { data: current } = await db.from("system_settings").select("value").eq("key", "customer_features").single();
      const originalValue = current!.value;
      try {
        await db
          .from("system_settings")
          .update({ value: { ...(originalValue as object), order_cancellation_enabled: false } })
          .eq("key", "customer_features");

        const merchantOrderId = await createDisposableOrder(customerUserId, addressId, variantId);
        const res = await callFunction("order-status", {
          token: customerToken,
          body: { merchant_order_id: merchantOrderId, status: "cancelled" },
        });
        expect(res.status).toBe(403);

        await db.rpc("release_stock", { p_variant_id: variantId, p_quantity: 1, p_reference_id: merchantOrderId, p_as_sale: false });
        await db.from("merchant_orders").update({ status: "cancelled" }).eq("id", merchantOrderId);
      } finally {
        // Restore the exact prior value (not a hardcoded guess at every key)
        // so no other test file or admin session sees a field silently dropped.
        await db.from("system_settings").update({ value: originalValue }).eq("key", "customer_features");
      }
    });
  });
});
