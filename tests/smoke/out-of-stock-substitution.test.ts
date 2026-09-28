import { beforeAll, describe, expect, inject, it } from "vitest";
import { env, serviceClient, signIn } from "../env.ts";
import { callFunction } from "../helpers.ts";

// Group 4, item 15 (migration 0065). The customer picks, per cart item,
// what should happen if it turns out the merchant can't actually fulfill
// it -- remove just that item, let the merchant substitute one of their
// own products, or cancel the whole order. resolve_unavailable_order_item
// (via the resolve-order-item Edge Function) is the merchant's single,
// server-enforced way to apply that choice; "cancel_order" reuses the
// existing whole-merchant_order reject flow (already covered by
// auto-refund-on-reject.test.ts) so it isn't retested here.
const db = serviceClient();

async function createDisposableOrder(
  customerUserId: string,
  addressId: string,
  variantId: string,
  onUnavailable?: "remove" | "substitute" | "cancel_order",
) {
  const item: Record<string, unknown> = { variant_id: variantId, quantity: 1 };
  if (onUnavailable) item.on_unavailable = onUnavailable;
  const { data: orderId, error } = await db.rpc("create_order", {
    p_customer_id: customerUserId,
    p_address_id: addressId,
    p_items: [item],
  });
  if (error) throw error;
  const { data: mo, error: moError } = await db
    .from("merchant_orders")
    .select("id, subtotal, merchant_payable, commission_amount")
    .eq("order_id", orderId as string)
    .single();
  if (moError) throw moError;
  const { data: orderItem, error: itemError } = await db.from("order_items").select("id").eq("merchant_order_id", mo.id).single();
  if (itemError) throw itemError;
  return { orderId: orderId as string, merchantOrderId: mo.id as string, orderItemId: orderItem.id as string, mo };
}

async function markPaidViaCashOnDelivery(orderId: string, staffToken: string) {
  const { data: payment, error } = await db.from("payments").insert({ order_id: orderId, provider: "cash_on_delivery", amount: 1 }).select().single();
  if (error) throw error;
  const res = await callFunction("confirm-payment", { token: staffToken, body: { payment_id: payment.id } });
  if (res.status !== 200) throw new Error(`confirm-payment failed: ${res.status} ${JSON.stringify(res.json)}`);
}

describe("out-of-stock substitution choice (migration 0065)", () => {
  let merchantAToken: string;
  let merchantBToken: string;
  let staffToken: string;
  let customerUserId: string;
  let addressId: string;
  let variantId: string;
  let reviewableVariantAId: string;

  beforeAll(async () => {
    merchantAToken = await signIn(env.qaMerchantAEmail, env.qaMerchantAPassword);
    merchantBToken = await signIn(env.qaMerchantBEmail, env.qaMerchantBPassword);
    staffToken = await signIn(env.qaStaffEmail, env.qaStaffPassword);
    const fixtures = inject("qaFixtures");
    customerUserId = fixtures.customerUserId;
    addressId = fixtures.addressId;
    variantId = fixtures.variantId;
    const { data: variant } = await db.from("product_variants").select("id").eq("product_id", fixtures.reviewableProductAId).single();
    reviewableVariantAId = variant!.id as string;
  });

  it("create_order defaults on_unavailable to 'remove' when the caller doesn't send one", async () => {
    const { orderItemId } = await createDisposableOrder(customerUserId, addressId, variantId);
    const { data: item } = await db.from("order_items").select("on_unavailable").eq("id", orderItemId).single();
    expect(item!.on_unavailable).toBe("remove");
  });

  it("create_order stores the caller's explicit on_unavailable preference", async () => {
    const { orderItemId } = await createDisposableOrder(customerUserId, addressId, variantId, "substitute");
    const { data: item } = await db.from("order_items").select("on_unavailable").eq("id", orderItemId).single();
    expect(item!.on_unavailable).toBe("substitute");
  });

  it("'remove': releases stock, zeroes the item out of the merchant_order/order totals, and refunds it when already paid", async () => {
    const { orderId, merchantOrderId, orderItemId, mo } = await createDisposableOrder(customerUserId, addressId, variantId, "remove");
    await markPaidViaCashOnDelivery(orderId, staffToken);

    const { data: inventoryBefore } = await db.from("inventory").select("reserved_quantity").eq("variant_id", variantId).single();

    const res = await callFunction("resolve-order-item", {
      token: merchantAToken,
      body: { order_item_id: orderItemId, action: "remove" },
    });
    expect(res.status).toBe(200);

    const { data: item } = await db.from("order_items").select("item_status, resolution_note, subtotal").eq("id", orderItemId).single();
    expect(item!.item_status).toBe("removed");
    expect(item!.resolution_note).toBeTruthy();

    const { data: updatedMo } = await db
      .from("merchant_orders")
      .select("subtotal, merchant_payable, commission_amount")
      .eq("id", merchantOrderId)
      .single();
    expect(Number(updatedMo!.subtotal)).toBeCloseTo(Number(mo.subtotal) - Number(item!.subtotal), 2);
    expect(Number(updatedMo!.merchant_payable)).toBeLessThan(Number(mo.merchant_payable));

    const { data: order } = await db.from("orders").select("subtotal, total").eq("id", orderId).single();
    expect(Number(order!.subtotal)).toBeLessThan(Number(mo.subtotal));

    const { data: inventoryAfter } = await db.from("inventory").select("reserved_quantity").eq("variant_id", variantId).single();
    expect(Number(inventoryAfter!.reserved_quantity)).toBe(Number(inventoryBefore!.reserved_quantity) - 1);

    const { data: returns } = await db.from("returns").select("id, order_item_id").eq("order_item_id", orderItemId);
    expect(returns).toHaveLength(1);
    const { data: refund } = await db.from("refunds").select("amount, status").eq("return_id", returns![0].id).single();
    expect(refund!.status).toBe("pending");
    expect(Number(refund!.amount)).toBeCloseTo(Number(item!.subtotal), 2);
  });

  it("'remove': does not open a refund when the order was never paid", async () => {
    const { orderItemId } = await createDisposableOrder(customerUserId, addressId, variantId, "remove");

    const res = await callFunction("resolve-order-item", {
      token: merchantAToken,
      body: { order_item_id: orderItemId, action: "remove" },
    });
    expect(res.status).toBe(200);

    const { data: returns } = await db.from("returns").select("id").eq("order_item_id", orderItemId);
    expect(returns).toHaveLength(0);
  });

  it("'substitute': swaps the item to the merchant's own replacement variant and recomputes its price", async () => {
    const { merchantOrderId, orderItemId } = await createDisposableOrder(customerUserId, addressId, variantId, "substitute");

    const res = await callFunction("resolve-order-item", {
      token: merchantAToken,
      body: { order_item_id: orderItemId, action: "substitute", substitute_variant_id: reviewableVariantAId },
    });
    expect(res.status).toBe(200);

    const { data: item } = await db
      .from("order_items")
      .select("variant_id, item_status, resolution_note, subtotal")
      .eq("id", orderItemId)
      .single();
    expect(item!.variant_id).toBe(reviewableVariantAId);
    expect(item!.item_status).toBe("substituted");
    expect(item!.resolution_note).toBeTruthy();

    const { data: mo } = await db.from("merchant_orders").select("subtotal").eq("id", merchantOrderId).single();
    expect(Number(mo!.subtotal)).toBeCloseTo(Number(item!.subtotal), 2);
  });

  it("'substitute': rejects a replacement variant that doesn't belong to the merchant", async () => {
    const { orderItemId } = await createDisposableOrder(customerUserId, addressId, variantId, "substitute");

    // resolve_unavailable_order_item is only ever called via the
    // resolve-order-item Edge Function's service-role client (it's
    // revoked from authenticated/anon), so this exercises its own
    // ownership check directly, the same way the RPC is actually invoked.
    // A nonexistent variant id hits the same "not found or wrong merchant"
    // branch as a real cross-merchant one, without needing a second
    // merchant's own product in the fixture set.
    const { error } = await db.rpc("resolve_unavailable_order_item", {
      p_order_item_id: orderItemId,
      p_action: "substitute",
      p_substitute_variant_id: "00000000-0000-0000-0000-000000000000",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain("must be one of your own");
  });

  it("cannot resolve an item that was already resolved", async () => {
    const { orderItemId } = await createDisposableOrder(customerUserId, addressId, variantId, "remove");

    const first = await callFunction("resolve-order-item", { token: merchantAToken, body: { order_item_id: orderItemId, action: "remove" } });
    expect(first.status).toBe(200);

    const second = await callFunction("resolve-order-item", { token: merchantAToken, body: { order_item_id: orderItemId, action: "remove" } });
    expect(second.status).toBe(400);
  });

  it("an unrelated merchant (B) cannot resolve merchant A's order item — 403, no state change", async () => {
    const { orderItemId } = await createDisposableOrder(customerUserId, addressId, variantId, "remove");

    const res = await callFunction("resolve-order-item", { token: merchantBToken, body: { order_item_id: orderItemId, action: "remove" } });
    expect(res.status).toBe(403);

    const { data: item } = await db.from("order_items").select("item_status").eq("id", orderItemId).single();
    expect(item!.item_status).toBe("active");
  });

  it("an unauthenticated caller cannot resolve any order item — 401, no state change", async () => {
    const { orderItemId } = await createDisposableOrder(customerUserId, addressId, variantId, "remove");

    const res = await callFunction("resolve-order-item", { body: { order_item_id: orderItemId, action: "remove" } });
    expect(res.status).toBe(401);

    const { data: item } = await db.from("order_items").select("item_status").eq("id", orderItemId).single();
    expect(item!.item_status).toBe("active");
  });
});
