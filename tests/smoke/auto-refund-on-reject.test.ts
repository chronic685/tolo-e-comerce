import { beforeAll, describe, expect, inject, it } from "vitest";
import { env, serviceClient, signIn } from "../env.ts";
import { callFunction } from "../helpers.ts";

// Group 1, item 5 (migration 0058). Verified first: a merchant rejecting
// or cancelling an already-paid order previously released stock but never
// refunded the customer. refund_merchant_order_if_paid() closes that gap,
// called from order-status/index.ts's existing reject/cancelled branch.
const db = serviceClient();

async function createDisposableOrder(customerUserId: string, addressId: string, variantId: string) {
  const { data: orderId, error } = await db.rpc("create_order", {
    p_customer_id: customerUserId,
    p_address_id: addressId,
    p_items: [{ variant_id: variantId, quantity: 1 }],
  });
  if (error) throw error;
  const { data: mo, error: moError } = await db.from("merchant_orders").select("id, subtotal").eq("order_id", orderId as string).single();
  if (moError) throw moError;
  return { orderId: orderId as string, merchantOrderId: mo.id as string, subtotal: mo.subtotal as number };
}

async function markPaidViaCashOnDelivery(orderId: string, staffToken: string) {
  const { data: payment, error } = await db.from("payments").insert({ order_id: orderId, provider: "cash_on_delivery", amount: 1 }).select().single();
  if (error) throw error;
  const res = await callFunction("confirm-payment", { token: staffToken, body: { payment_id: payment.id } });
  if (res.status !== 200) throw new Error(`confirm-payment failed: ${res.status} ${JSON.stringify(res.json)}`);
}

async function refundFor(merchantOrderId: string) {
  const { data: returns } = await db.from("returns").select("id, status, reason").eq("merchant_order_id", merchantOrderId);
  if (!returns || returns.length === 0) return null;
  const { data: refunds } = await db.from("refunds").select("id, amount, status").eq("return_id", returns[0].id).maybeSingle();
  return refunds ? { ...refunds, returnStatus: returns[0].status, reason: returns[0].reason } : null;
}

describe("auto-refund on merchant reject/cancel (migration 0058)", () => {
  let merchantAToken: string;
  let staffToken: string;
  let customerUserId: string;
  let addressId: string;
  let variantId: string;

  beforeAll(async () => {
    merchantAToken = await signIn(env.qaMerchantAEmail, env.qaMerchantAPassword);
    staffToken = await signIn(env.qaStaffEmail, env.qaStaffPassword);
    const fixtures = inject("qaFixtures");
    customerUserId = fixtures.customerUserId;
    addressId = fixtures.addressId;
    variantId = fixtures.variantId;
  });

  it("opens a pending refund for the rejected merchant_order's net amount when the order was already paid", async () => {
    const { orderId, merchantOrderId, subtotal } = await createDisposableOrder(customerUserId, addressId, variantId);
    await markPaidViaCashOnDelivery(orderId, staffToken);

    const res = await callFunction("order-status", {
      token: merchantAToken,
      body: { merchant_order_id: merchantOrderId, status: "rejected" },
    });
    expect(res.status).toBe(200);

    const refund = await refundFor(merchantOrderId);
    expect(refund).not.toBeNull();
    expect(refund!.status).toBe("pending");
    expect(refund!.returnStatus).toBe("approved");
    expect(Number(refund!.amount)).toBeCloseTo(subtotal, 2);
  });

  it("does not open a refund when the order was never paid", async () => {
    const { merchantOrderId } = await createDisposableOrder(customerUserId, addressId, variantId);

    const res = await callFunction("order-status", {
      token: merchantAToken,
      body: { merchant_order_id: merchantOrderId, status: "rejected" },
    });
    expect(res.status).toBe(200);

    const refund = await refundFor(merchantOrderId);
    expect(refund).toBeNull();
  });

  it("is idempotent: calling the RPC twice for the same merchant_order never creates two refunds", async () => {
    const { orderId, merchantOrderId } = await createDisposableOrder(customerUserId, addressId, variantId);
    await markPaidViaCashOnDelivery(orderId, staffToken);

    await callFunction("order-status", { token: merchantAToken, body: { merchant_order_id: merchantOrderId, status: "rejected" } });

    const { error } = await db.rpc("refund_merchant_order_if_paid", {
      p_merchant_order_id: merchantOrderId,
      p_reason: "Merchant declined the order",
    });
    expect(error).toBeNull();

    const { data: returns } = await db.from("returns").select("id").eq("merchant_order_id", merchantOrderId);
    expect(returns).toHaveLength(1);
  });
});
