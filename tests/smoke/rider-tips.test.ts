import { afterEach, beforeAll, describe, expect, inject, it } from "vitest";
import { env, serviceClient, signIn } from "../env.ts";
import { callFunction } from "../helpers.ts";

// Group 4, item 16 (migration 0066). A tip is for the delivery rider, not
// the merchant — it must be recorded on orders.rider_tip, collected in the
// payment amount actually charged, but never merged into orders.total or
// any merchant_orders split (commission, merchant_payable). No rider
// payout mechanism exists yet (Tolo Transport is out of scope here) — this
// only checks that the tip is captured and kept separate.
const db = serviceClient();

describe("rider tips (migration 0066)", () => {
  let customerToken: string;
  let customerUserId: string;
  let addressId: string;
  let variantId: string;

  const cleanupOrderIds: string[] = [];

  beforeAll(async () => {
    customerToken = await signIn(env.qaCustomerEmail, env.qaCustomerPassword);
    const fixtures = inject("qaFixtures");
    customerUserId = fixtures.customerUserId;
    addressId = fixtures.addressId;
    variantId = fixtures.variantId;
  });

  // Every disposable order created below reserves real stock -- release it
  // and leave the order in a terminal state rather than dangling "new"
  // forever, same convention as merchant-authorization.test.ts's D1.
  afterEach(async () => {
    for (const orderId of cleanupOrderIds.splice(0)) {
      const { data: mo } = await db.from("merchant_orders").select("id").eq("order_id", orderId).single();
      if (!mo) continue;
      await db.rpc("release_stock", { p_variant_id: variantId, p_quantity: 1, p_reference_id: orderId, p_as_sale: false });
      await db.from("merchant_orders").update({ status: "cancelled" }).eq("id", mo.id);
    }
  });

  it("create_order defaults rider_tip to 0 when the caller doesn't send one", async () => {
    const { data: orderId, error } = await db.rpc("create_order", {
      p_customer_id: customerUserId,
      p_address_id: addressId,
      p_items: [{ variant_id: variantId, quantity: 1 }],
    });
    expect(error).toBeNull();
    cleanupOrderIds.push(orderId as string);

    const { data: order } = await db.from("orders").select("rider_tip, total").eq("id", orderId as string).single();
    expect(Number(order!.rider_tip)).toBe(0);
  });

  it("create_order rejects a negative rider_tip", async () => {
    const { error } = await db.rpc("create_order", {
      p_customer_id: customerUserId,
      p_address_id: addressId,
      p_items: [{ variant_id: variantId, quantity: 1 }],
      p_rider_tip: -5,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain("cannot be negative");
  });

  async function seedCartWithOneItem(): Promise<string> {
    let { data: cart } = await db.from("carts").select("id").eq("customer_id", customerUserId).maybeSingle();
    if (!cart) {
      const inserted = await db.from("carts").insert({ customer_id: customerUserId }).select("id").single();
      cart = inserted.data;
    }
    await db.from("cart_items").delete().eq("cart_id", cart!.id);
    await db.from("cart_items").insert({ cart_id: cart!.id, variant_id: variantId, quantity: 1 });
    return cart!.id as string;
  }

  it("checkout stores the tip separately from the order total and charges total+tip", async () => {
    await seedCartWithOneItem();

    // bank_transfer, not cash_on_delivery -- this uses the shared QA
    // customer (qaCustomerEmail, reused across many test files, unlike
    // cod-fraud-controls.test.ts's own disposable-per-test customers), so
    // a COD checkout here could legitimately trip cod_fraud_controls'
    // max_cod_orders once enough *other* files' real COD checkouts have
    // already run against this same account earlier in the suite.
    // Rider-tip behavior itself doesn't depend on which provider is used
    // (checkout/index.ts adds rider_tip to amountDue the same way
    // regardless), so there's no need to risk that interaction here.
    const res = await callFunction("checkout", {
      token: customerToken,
      body: { address_id: addressId, payment_provider: "bank_transfer", rider_tip: 25 },
    });
    expect(res.status).toBe(200);
    const body = res.json as { order_id: string; payment_id: string; amount: number };
    cleanupOrderIds.push(body.order_id);

    const { data: order } = await db.from("orders").select("total, rider_tip").eq("id", body.order_id).single();
    expect(Number(order!.rider_tip)).toBe(25);
    expect(body.amount).toBeCloseTo(Number(order!.total) + 25, 2);

    const { data: payment } = await db.from("payments").select("amount").eq("id", body.payment_id).single();
    expect(Number(payment!.amount)).toBeCloseTo(Number(order!.total) + 25, 2);

    // The tip must never leak into the merchant's own split.
    const { data: mo } = await db.from("merchant_orders").select("subtotal, merchant_payable").eq("order_id", body.order_id).single();
    expect(Number(mo!.subtotal)).toBeCloseTo(Number(order!.total), 2);
  });

  it("checkout rejects a negative rider_tip", async () => {
    await seedCartWithOneItem();

    const res = await callFunction("checkout", {
      token: customerToken,
      body: { address_id: addressId, payment_provider: "cash_on_delivery", rider_tip: -10 },
    });
    expect(res.status).toBe(400);
  });
});
