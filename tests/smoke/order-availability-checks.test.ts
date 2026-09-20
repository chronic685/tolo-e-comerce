import { afterEach, beforeAll, describe, expect, inject, it } from "vitest";
import { serviceClient } from "../env.ts";

// Phase 5c, item 5: create_order() never checked merchant or product status
// — a stale cart or a direct call could complete checkout against a
// suspended merchant or an unpublished product. Calls create_order()
// directly via the service client (bypassing the checkout Edge Function
// entirely) specifically because that's the exact gap this fix closes: the
// backend itself must reject this, not just the Marketplace UI's
// status='published' filter.
const db = serviceClient();

async function attemptOrder(customerUserId: string, addressId: string, variantId: string) {
  return db.rpc("create_order", {
    p_customer_id: customerUserId,
    p_address_id: addressId,
    p_items: [{ variant_id: variantId, quantity: 1 }],
  });
}

// Releases the stock a successful create_order() call reserved and leaves
// the order in a terminal state, matching the cleanup convention already
// used in tests/smoke/order-status-inventory.test.ts.
async function releaseAndCancel(orderId: string, variantId: string) {
  await db.rpc("release_stock", { p_variant_id: variantId, p_quantity: 1, p_reference_id: orderId, p_as_sale: false });
  await db.from("merchant_orders").update({ status: "cancelled" }).eq("order_id", orderId);
}

describe("create_order: merchant and product availability checks", () => {
  let customerUserId: string;
  let addressId: string;
  let variantId: string;
  let merchantAId: string;
  let productId: string;

  beforeAll(async () => {
    const fixtures = inject("qaFixtures");
    customerUserId = fixtures.customerUserId;
    addressId = fixtures.addressId;
    variantId = fixtures.variantId;
    merchantAId = fixtures.merchantAId;
    const { data: variant, error } = await db.from("product_variants").select("product_id").eq("id", variantId).single();
    if (error) throw error;
    productId = variant.product_id;
  });

  afterEach(async () => {
    // Whatever a test changed, always restore the fixture to its normal,
    // reusable state for every other file relying on it.
    await db.from("merchants").update({ status: "active" }).eq("id", merchantAId);
    await db.from("products").update({ status: "published" }).eq("id", productId);
  });

  it("rejects an order when the merchant is suspended", async () => {
    await db.from("merchants").update({ status: "suspended" }).eq("id", merchantAId);

    const { data, error } = await attemptOrder(customerUserId, addressId, variantId);
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error!.message).toContain("not currently available for orders");
  });

  it("rejects an order when the product is paused (not published)", async () => {
    await db.from("products").update({ status: "paused" }).eq("id", productId);

    const { data, error } = await attemptOrder(customerUserId, addressId, variantId);
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error!.message).toContain("no longer available");
  });

  it("still allows an order when the merchant is only 'approved' — matches MerchantGate.tsx's own tolerance, not stricter", async () => {
    await db.from("merchants").update({ status: "approved" }).eq("id", merchantAId);

    const { data: orderId, error } = await attemptOrder(customerUserId, addressId, variantId);
    expect(error).toBeNull();
    expect(orderId).toBeTruthy();

    await releaseAndCancel(orderId as string, variantId);
  });

  it("a legitimate order (active merchant, published product) still succeeds — this fix doesn't reject the normal path", async () => {
    const { data: orderId, error } = await attemptOrder(customerUserId, addressId, variantId);
    expect(error).toBeNull();
    expect(orderId).toBeTruthy();

    await releaseAndCancel(orderId as string, variantId);
  });
});
