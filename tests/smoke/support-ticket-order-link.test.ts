import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, inject, it } from "vitest";
import { env, serviceClient, signIn } from "../env.ts";

// Phase 10: order-linked dispute resolution. support_tickets gains a
// nullable merchant_order_id (migration 0044) -- not order_id, since an
// order can fan out into several merchant_orders (one per merchant in a
// multi-vendor cart) each with independent fulfillment status, and
// OrderDetail.tsx already carves up an order the same way (the cancel
// button, the review widget are both per-merchant_order). The real question
// this file answers: can a customer link a ticket to someone ELSE's order?
// The insert RLS policy is supposed to say no -- this proves it against a
// real authenticated client, not the service-role client.
const db = serviceClient();

function asUser(token: string) {
  return createClient(env.supabaseUrl, env.anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
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

describe("support_tickets: order-linked disputes", () => {
  let customerToken: string;
  let staffToken: string;
  let customerUserId: string;
  let merchantAUserId: string;
  let addressId: string;
  let variantId: string;

  beforeAll(async () => {
    customerToken = await signIn(env.qaCustomerEmail, env.qaCustomerPassword);
    staffToken = await signIn(env.qaStaffEmail, env.qaStaffPassword);
    const fixtures = inject("qaFixtures");
    customerUserId = fixtures.customerUserId;
    merchantAUserId = fixtures.merchantAUserId;
    addressId = fixtures.addressId;
    variantId = fixtures.variantId;
  });

  it("lets a customer link a ticket to their own order", async () => {
    const merchantOrderId = await createDisposableOrder(customerUserId, addressId, variantId);
    const asCustomer = asUser(customerToken);

    const { data, error } = await asCustomer
      .from("support_tickets")
      .insert({ user_id: customerUserId, merchant_order_id: merchantOrderId, subject: "QA TEST — item never arrived" })
      .select("id")
      .single();
    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();

    // Cleanup: release the reservation and leave the disposable order cancelled.
    await db.rpc("release_stock", { p_variant_id: variantId, p_quantity: 1, p_reference_id: merchantOrderId, p_as_sale: false });
    await db.from("merchant_orders").update({ status: "cancelled" }).eq("id", merchantOrderId);
  });

  it("blocks a customer from linking a ticket to someone else's order", async () => {
    // A disposable order belonging to Merchant A's own user id, standing in
    // for "a different customer" -- create_order()/addresses have no
    // ownership check tying an address to the customer using it, so
    // reusing the QA fixture address here is fine; the point is the
    // resulting merchant_order's real owner is merchantAUserId, not
    // customerUserId.
    const otherPersonsMerchantOrderId = await createDisposableOrder(merchantAUserId, addressId, variantId);
    const asCustomer = asUser(customerToken);

    const { error } = await asCustomer
      .from("support_tickets")
      .insert({ user_id: customerUserId, merchant_order_id: otherPersonsMerchantOrderId, subject: "QA TEST — should be rejected" });
    expect(error).not.toBeNull();

    await db.rpc("release_stock", {
      p_variant_id: variantId,
      p_quantity: 1,
      p_reference_id: otherPersonsMerchantOrderId,
      p_as_sale: false,
    });
    await db.from("merchant_orders").update({ status: "cancelled" }).eq("id", otherPersonsMerchantOrderId);
  });

  it("still allows a general ticket with no order link at all", async () => {
    const asCustomer = asUser(customerToken);
    const { error } = await asCustomer
      .from("support_tickets")
      .insert({ user_id: customerUserId, subject: "QA TEST — general ticket, no order link" });
    expect(error).toBeNull();
  });

  it("lets a customer read back their own ticket with the linked order resolved", async () => {
    const merchantOrderId = await createDisposableOrder(customerUserId, addressId, variantId);
    const asCustomer = asUser(customerToken);

    const { data: ticket, error: insertError } = await asCustomer
      .from("support_tickets")
      .insert({ user_id: customerUserId, merchant_order_id: merchantOrderId, subject: "QA TEST — read back" })
      .select("id")
      .single();
    expect(insertError).toBeNull();

    const { data: fetched, error: fetchError } = await asCustomer
      .from("support_tickets")
      .select("id, merchant_order_id, merchant_orders ( order_id, merchants ( business_name ) )")
      .eq("id", ticket!.id)
      .single();
    expect(fetchError).toBeNull();
    expect(fetched!.merchant_order_id).toBe(merchantOrderId);
    expect((fetched as unknown as { merchant_orders: { order_id: string } }).merchant_orders.order_id).toBeTruthy();

    await db.rpc("release_stock", { p_variant_id: variantId, p_quantity: 1, p_reference_id: merchantOrderId, p_as_sale: false });
    await db.from("merchant_orders").update({ status: "cancelled" }).eq("id", merchantOrderId);
  });

  it("lets Tolo staff read any customer's linked-order ticket, for triage", async () => {
    const merchantOrderId = await createDisposableOrder(customerUserId, addressId, variantId);
    const asCustomer = asUser(customerToken);
    const { data: ticket, error: insertError } = await asCustomer
      .from("support_tickets")
      .insert({ user_id: customerUserId, merchant_order_id: merchantOrderId, subject: "QA TEST — staff triage" })
      .select("id")
      .single();
    expect(insertError).toBeNull();

    const asStaff = asUser(staffToken);
    const { data: fetched, error: fetchError } = await asStaff
      .from("support_tickets")
      .select("id, merchant_orders ( order_id, merchants ( business_name ) )")
      .eq("id", ticket!.id)
      .single();
    expect(fetchError).toBeNull();
    expect((fetched as unknown as { merchant_orders: { order_id: string } }).merchant_orders.order_id).toBeTruthy();

    await db.rpc("release_stock", { p_variant_id: variantId, p_quantity: 1, p_reference_id: merchantOrderId, p_as_sale: false });
    await db.from("merchant_orders").update({ status: "cancelled" }).eq("id", merchantOrderId);
  });
});
