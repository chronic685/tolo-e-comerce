import { beforeAll, describe, expect, inject, it } from "vitest";
import { env, serviceClient, signIn } from "../env.ts";
import { callFunction } from "../helpers.ts";

// Migration 0098 and the order-status function: a new order goes straight to "processing" in one request (accept and
// start preparing), with both timestamps and both history rows recorded together and ONE customer message; the
// merchant can only take the next legal step on its own orders; a repeat request is a harmless no-op. Orders are
// created for the is_test QA merchant and customer and removed by the suite's teardown (delete_qa_orders).
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
  return { orderId: orderId as string, merchantOrderId: mo.id as string };
}

describe("order-status: the one-button flow", () => {
  let merchantAToken: string;
  let merchantBToken: string;
  let addressId: string;
  let variantId: string;
  let customerUserId: string;

  beforeAll(async () => {
    merchantAToken = await signIn(env.qaMerchantAEmail, env.qaMerchantAPassword);
    merchantBToken = await signIn(env.qaMerchantBEmail, env.qaMerchantBPassword);
    const fixtures = inject("qaFixtures");
    addressId = fixtures.addressId;
    variantId = fixtures.variantId;
    customerUserId = fixtures.customerUserId;
  });

  const move = (token: string, id: string, status: string) => callFunction("order-status", { token, body: { merchant_order_id: id, status } });

  it("accepts and starts preparing in one request: one status change, both timestamps, both history rows", async () => {
    const { merchantOrderId } = await createDisposableOrder(customerUserId, addressId, variantId);
    const res = await move(merchantAToken, merchantOrderId, "processing");
    expect(res.status).toBe(200);

    const { data: mo } = await db.from("merchant_orders").select("status, order_received_at, preparation_started_at, received_by").eq("id", merchantOrderId).single();
    expect(mo!.status).toBe("processing");
    expect(mo!.order_received_at).not.toBeNull();
    expect(mo!.preparation_started_at).not.toBeNull();
    expect(mo!.received_by).not.toBeNull();

    const { data: history } = await db.from("order_status_history").select("status, changed_at").eq("merchant_order_id", merchantOrderId);
    const rows = (history ?? []).filter((h) => h.status !== "new"); // checkout wrote the first row, "new"
    expect(rows.map((h) => h.status).sort()).toEqual(["accepted", "processing"]);
    expect(rows[0].changed_at).toBe(rows[1].changed_at); // the same instant: nothing half-done in between
  });

  it("sends the customer ONE message for it, not 'received' then 'preparing'", async () => {
    const { merchantOrderId, orderId } = await createDisposableOrder(customerUserId, addressId, variantId);
    const { data: order } = await db.from("orders").select("order_number").eq("id", orderId).single();
    const since = new Date().toISOString();
    expect((await move(merchantAToken, merchantOrderId, "processing")).status).toBe(200);

    const { data: notes } = await db
      .from("notifications")
      .select("type, body")
      .eq("user_id", customerUserId)
      .gte("created_at", since)
      .like("body", `%${`TL-${order!.order_number}`}%`);
    const types = (notes ?? []).map((n) => n.type);
    expect(types.filter((t) => t === "order_accepted_preparing")).toHaveLength(1);
    expect(types).not.toContain("order_received");
    expect(types).not.toContain("order_preparing");
  });

  it("walks the rest of the merchant's path, one legal step at a time, and refuses the driver's steps", async () => {
    const { merchantOrderId } = await createDisposableOrder(customerUserId, addressId, variantId);
    expect((await move(merchantAToken, merchantOrderId, "ready_for_pickup")).status).toBe(400); // not from new
    expect((await move(merchantAToken, merchantOrderId, "processing")).status).toBe(200);
    expect((await move(merchantAToken, merchantOrderId, "picked_up")).status).toBe(400); // not before ready
    expect((await move(merchantAToken, merchantOrderId, "ready_for_pickup")).status).toBe(200);
    expect((await move(merchantAToken, merchantOrderId, "delivered")).status).toBe(400); // the driver's step
    expect((await move(merchantAToken, merchantOrderId, "picked_up")).status).toBe(200);
    expect((await move(merchantAToken, merchantOrderId, "cancelled")).status).toBe(400); // too late to cancel
    expect((await move(merchantAToken, merchantOrderId, "processing")).status).toBe(400); // never backwards
  });

  it("treats a repeated request as a no-op: no error, nothing changed twice", async () => {
    const { merchantOrderId } = await createDisposableOrder(customerUserId, addressId, variantId);
    expect((await move(merchantAToken, merchantOrderId, "processing")).status).toBe(200);
    const { data: before } = await db.from("order_status_history").select("id").eq("merchant_order_id", merchantOrderId);
    const again = await move(merchantAToken, merchantOrderId, "processing");
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ ok: true, unchanged: true });
    const { data: after } = await db.from("order_status_history").select("id").eq("merchant_order_id", merchantOrderId);
    expect(after).toHaveLength(before!.length);
  });

  it("will not let one merchant touch another merchant's order, even a no-op", async () => {
    const { merchantOrderId } = await createDisposableOrder(customerUserId, addressId, variantId);
    expect((await move(merchantBToken, merchantOrderId, "processing")).status).toBe(403);
    expect((await move(merchantAToken, merchantOrderId, "processing")).status).toBe(200);
    expect((await move(merchantBToken, merchantOrderId, "processing")).status).toBe(403);
    expect((await move(merchantBToken, merchantOrderId, "ready_for_pickup")).status).toBe(403);
  });

  it("still takes the older two-step path for existing clients: accepted, then processing", async () => {
    const { merchantOrderId } = await createDisposableOrder(customerUserId, addressId, variantId);
    expect((await move(merchantAToken, merchantOrderId, "accepted")).status).toBe(200);
    expect((await move(merchantAToken, merchantOrderId, "processing")).status).toBe(200);
  });
});
