import { beforeAll, describe, expect, inject, it } from "vitest";
import { env, serviceClient, signIn } from "../env.ts";
import { callFunction } from "../helpers.ts";

// Group 1, item 3: human-readable, sequence-based order numbers
// (migration 0056). Verifies create_order() actually populates
// orders.order_number (not just that the column exists), that numbers are
// unique and increase order-to-order, and that the notification templates
// this migration rewrote resolve {{order_number}} end-to-end through the
// real finalizePaymentSuccess() path instead of leaving a literal,
// unfilled placeholder or the old UUID fragment.
const db = serviceClient();

async function createDisposableOrder(customerUserId: string, addressId: string, variantId: string) {
  const { data: orderId, error } = await db.rpc("create_order", {
    p_customer_id: customerUserId,
    p_address_id: addressId,
    p_items: [{ variant_id: variantId, quantity: 1 }],
  });
  if (error) throw error;
  return orderId as string;
}

describe("readable order numbers (orders.order_number, migration 0056)", () => {
  let customerUserId: string;
  let addressId: string;
  let variantId: string;

  beforeAll(async () => {
    await signIn(env.qaCustomerEmail, env.qaCustomerPassword);
    const fixtures = inject("qaFixtures");
    customerUserId = fixtures.customerUserId;
    addressId = fixtures.addressId;
    variantId = fixtures.variantId;
  });

  it("assigns a positive, unique order_number to a newly created order", async () => {
    const orderId = await createDisposableOrder(customerUserId, addressId, variantId);
    const { data: order, error } = await db.from("orders").select("order_number").eq("id", orderId).single();
    expect(error).toBeNull();
    expect(order!.order_number).toBeGreaterThan(0);
    expect(Number.isInteger(order!.order_number)).toBe(true);
  });

  it("gives two orders distinct, increasing order_numbers", async () => {
    const firstId = await createDisposableOrder(customerUserId, addressId, variantId);
    const secondId = await createDisposableOrder(customerUserId, addressId, variantId);

    const { data: first, error: firstError } = await db.from("orders").select("order_number").eq("id", firstId).single();
    const { data: second, error: secondError } = await db.from("orders").select("order_number").eq("id", secondId).single();
    expect(firstError).toBeNull();
    expect(secondError).toBeNull();
    expect(second!.order_number).toBeGreaterThan(first!.order_number);
  });

  it("every order_number in the table is unique (the constraint actually holds)", async () => {
    const { data, error } = await db.from("orders").select("order_number");
    expect(error).toBeNull();
    const numbers = (data ?? []).map((o) => o.order_number);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("payment_success notification shows the readable order number, not a raw UUID fragment", async () => {
    const staffToken = await signIn(env.qaStaffEmail, env.qaStaffPassword);
    const orderId = await createDisposableOrder(customerUserId, addressId, variantId);
    const { data: order } = await db.from("orders").select("order_number").eq("id", orderId).single();

    const { data: payment, error: paymentError } = await db
      .from("payments")
      .insert({ order_id: orderId, provider: "cash_on_delivery", amount: 1 })
      .select()
      .single();
    expect(paymentError).toBeNull();

    const res = await callFunction("confirm-payment", { token: staffToken, body: { payment_id: payment!.id } });
    expect(res.status).toBe(200);

    const { data: notifications, error } = await db
      .from("notifications")
      .select("body")
      .eq("user_id", customerUserId)
      .eq("type", "payment_success")
      .order("created_at", { ascending: false })
      .limit(1);
    expect(error).toBeNull();
    expect(notifications).toHaveLength(1);
    expect(notifications![0].body).toContain(`TL-${order!.order_number}`);
    expect(notifications![0].body).not.toContain("{{");
  });
});
