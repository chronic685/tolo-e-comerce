import { beforeAll, describe, expect, inject, it } from "vitest";
import { env, serviceClient, signIn } from "../env.ts";
import { callFunction } from "../helpers.ts";

// Phase 5c, item 4: delivery-dispatch updated merchant_orders/delivery_tracking
// for picked_up/delivered (and auto-completed) but never called
// sendNotification() — the customer notification stream went silent for the
// whole delivery leg. Wired in via the same template-driven pattern as
// order-status, asserted here against notifications/notification_templates
// directly.
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

async function latestNotification(userId: string, type: string) {
  const { data, error } = await db
    .from("notifications")
    .select("title, body")
    .eq("user_id", userId)
    .eq("type", type)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

describe("delivery-dispatch: customer notifications for picked_up/delivered", () => {
  let merchantAToken: string;
  let staffToken: string;
  let addressId: string;
  let variantId: string;
  let customerUserId: string;

  beforeAll(async () => {
    merchantAToken = await signIn(env.qaMerchantAEmail, env.qaMerchantAPassword);
    staffToken = await signIn(env.qaStaffEmail, env.qaStaffPassword);
    const fixtures = inject("qaFixtures");
    addressId = fixtures.addressId;
    variantId = fixtures.variantId;
    customerUserId = fixtures.customerUserId;
  });

  it("order_picked_up template exists and is enabled (order_delivered already did, from 0029)", async () => {
    const { data: templates, error } = await db
      .from("notification_templates")
      .select("event_type, enabled")
      .in("event_type", ["order_picked_up", "order_delivered"])
      .eq("channel", "in_app")
      .eq("language", "en");
    expect(error).toBeNull();
    expect(templates).toHaveLength(2);
    expect(templates!.every((t) => t.enabled)).toBe(true);
  });

  it("notifies the customer at picked_up and at delivered, and completes the order", async () => {
    const merchantOrderId = await createDisposableOrder(customerUserId, addressId, variantId);

    // Walk the order to ready_for_pickup, which is what creates the
    // deliveries row this test then drives via delivery-dispatch.
    for (const status of ["accepted", "processing", "ready_for_pickup"]) {
      const res = await callFunction("order-status", { token: merchantAToken, body: { merchant_order_id: merchantOrderId, status } });
      expect(res.status).toBe(200);
    }

    const { data: delivery, error: deliveryError } = await db
      .from("deliveries")
      .select("id")
      .eq("merchant_order_id", merchantOrderId)
      .single();
    expect(deliveryError).toBeNull();

    const pickedUpRes = await callFunction("delivery-dispatch", {
      token: staffToken,
      body: { delivery_id: delivery!.id, status: "picked_up" },
    });
    expect(pickedUpRes.status).toBe(200);

    const pickedUpNotification = await latestNotification(customerUserId, "order_picked_up");
    expect(pickedUpNotification).not.toBeNull();
    expect(pickedUpNotification!.body).toContain(merchantOrderId.slice(0, 8));
    expect(pickedUpNotification!.body).not.toContain("{{");

    const deliveredRes = await callFunction("delivery-dispatch", {
      token: staffToken,
      body: { delivery_id: delivery!.id, status: "delivered" },
    });
    expect(deliveredRes.status).toBe(200);

    const deliveredNotification = await latestNotification(customerUserId, "order_delivered");
    expect(deliveredNotification).not.toBeNull();
    expect(deliveredNotification!.body).toContain(merchantOrderId.slice(0, 8));

    const { data: finalOrder, error: finalOrderError } = await db
      .from("merchant_orders")
      .select("status")
      .eq("id", merchantOrderId)
      .single();
    expect(finalOrderError).toBeNull();
    expect(finalOrder!.status).toBe("completed");
  });

  it("an ordinary merchant (not Tolo staff) cannot call delivery-dispatch — unchanged by this phase", async () => {
    const merchantOrderId = await createDisposableOrder(customerUserId, addressId, variantId);
    for (const status of ["accepted", "processing", "ready_for_pickup"]) {
      await callFunction("order-status", { token: merchantAToken, body: { merchant_order_id: merchantOrderId, status } });
    }
    const { data: delivery } = await db.from("deliveries").select("id").eq("merchant_order_id", merchantOrderId).single();

    const res = await callFunction("delivery-dispatch", {
      token: merchantAToken,
      body: { delivery_id: delivery!.id, status: "picked_up" },
    });
    expect(res.status).toBe(403);
  });
});
