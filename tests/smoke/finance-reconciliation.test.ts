import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, inject, it } from "vitest";
import { env, serviceClient, signIn } from "../env.ts";

// Group 4, item 17 (migration 0067). Both finance_reconciliation_summary
// and _rows are their own authorization boundary (SECURITY DEFINER,
// crossing orders/payments/refunds/settlements as no single table's RLS
// covers all four) -- this checks the gate holds and the summary's own
// arithmetic is self-consistent against a real, known order placed inside
// the queried window.
const db = serviceClient();

function authedClient(token: string) {
  return createClient(env.supabaseUrl, env.anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

describe("finance reconciliation report (migration 0067)", () => {
  let staffToken: string;
  let customerToken: string;
  let customerUserId: string;
  let addressId: string;
  let variantId: string;

  beforeAll(async () => {
    staffToken = await signIn(env.qaStaffEmail, env.qaStaffPassword);
    customerToken = await signIn(env.qaCustomerEmail, env.qaCustomerPassword);
    const fixtures = inject("qaFixtures");
    customerUserId = fixtures.customerUserId;
    addressId = fixtures.addressId;
    variantId = fixtures.variantId;
  });

  it("a customer (no finance permission) cannot call the summary or the row export", async () => {
    const customerClient = authedClient(customerToken);
    const from = new Date(Date.now() - 24 * 3600_000).toISOString();
    const to = new Date().toISOString();

    const { error: summaryError } = await customerClient.rpc("finance_reconciliation_summary", { p_from: from, p_to: to }).single();
    expect(summaryError).not.toBeNull();
    expect(summaryError!.message).toContain("Not authorized");

    const { error: rowsError } = await customerClient.rpc("finance_reconciliation_rows", { p_from: from, p_to: to });
    expect(rowsError).not.toBeNull();
    expect(rowsError!.message).toContain("Not authorized");
  });

  it("Tolo finance staff can run the summary and it reflects a real order placed inside the window", async () => {
    const staffClient = authedClient(staffToken);

    const { data: orderId, error: orderError } = await db.rpc("create_order", {
      p_customer_id: customerUserId,
      p_address_id: addressId,
      p_items: [{ variant_id: variantId, quantity: 1 }],
    });
    expect(orderError).toBeNull();

    const { data: order } = await db.from("orders").select("total, created_at").eq("id", orderId as string).single();

    const from = new Date(new Date(order!.created_at).getTime() - 1000).toISOString();
    const to = new Date(new Date(order!.created_at).getTime() + 1000).toISOString();

    const { data: summary, error: summaryError } = await staffClient
      .rpc("finance_reconciliation_summary", { p_from: from, p_to: to })
      .single();
    expect(summaryError).toBeNull();
    const s = summary as {
      orders_count: number;
      orders_total: number;
    };
    expect(s.orders_count).toBeGreaterThanOrEqual(1);
    expect(Number(s.orders_total)).toBeGreaterThanOrEqual(Number(order!.total));

    const { data: rows, error: rowsError } = await staffClient.rpc("finance_reconciliation_rows", { p_from: from, p_to: to });
    expect(rowsError).toBeNull();
    const matching = (rows as { order_id: string }[]).find((r) => r.order_id === orderId);
    expect(matching).toBeTruthy();

    // Leave the disposable order in a terminal state rather than dangling.
    const { data: mo } = await db.from("merchant_orders").select("id").eq("order_id", orderId as string).single();
    await db.rpc("release_stock", { p_variant_id: variantId, p_quantity: 1, p_reference_id: orderId as string, p_as_sale: false });
    await db.from("merchant_orders").update({ status: "cancelled" }).eq("id", mo!.id);
  });

  it("the summary never includes activity outside the requested window", async () => {
    const staffClient = authedClient(staffToken);
    // A window far in the future has nothing in it -- the summary must
    // reflect that (zero orders/amounts), never leak unrelated totals.
    const from = new Date(Date.now() + 365 * 86_400_000).toISOString();
    const to = new Date(Date.now() + 366 * 86_400_000).toISOString();

    const { data: summary, error } = await staffClient.rpc("finance_reconciliation_summary", { p_from: from, p_to: to }).single();
    expect(error).toBeNull();
    const s = summary as { orders_count: number; orders_total: number };
    expect(s.orders_count).toBe(0);
    expect(Number(s.orders_total)).toBe(0);
  });
});
