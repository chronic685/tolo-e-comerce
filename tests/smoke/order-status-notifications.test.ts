import { beforeAll, describe, expect, inject, it } from "vitest";
import { env, serviceClient, signIn } from "../env.ts";
import { callFunction } from "../helpers.ts";

// Phase 5c, item 3: a merchant rejecting a brand-new order previously sent
// the customer no notification at all (order-status's CUSTOMER_NOTIFY_EVENTS
// had no "rejected" entry). Asserts against notifications/notification_templates
// directly rather than mocking a delivery provider — there is none; in-app
// notification is the real, existing channel (see _shared/notify.ts).
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

describe("order-status: customer notification on rejection", () => {
  let merchantAToken: string;
  let addressId: string;
  let variantId: string;
  let customerUserId: string;

  beforeAll(async () => {
    merchantAToken = await signIn(env.qaMerchantAEmail, env.qaMerchantAPassword);
    const fixtures = inject("qaFixtures");
    addressId = fixtures.addressId;
    variantId = fixtures.variantId;
    customerUserId = fixtures.customerUserId;
  });

  it("the order_rejected template exists and is enabled", async () => {
    const { data: template, error } = await db
      .from("notification_templates")
      .select("event_type, channel, language, enabled, title_template, body_template")
      .eq("event_type", "order_rejected")
      .eq("channel", "in_app")
      .eq("language", "en")
      .maybeSingle();
    expect(error).toBeNull();
    expect(template).not.toBeNull();
    expect(template!.enabled).toBe(true);
  });

  it("sends the customer a filled-in order_rejected notification when a merchant declines a new order", async () => {
    const merchantOrderId = await createDisposableOrder(customerUserId, addressId, variantId);

    const res = await callFunction("order-status", {
      token: merchantAToken,
      body: { merchant_order_id: merchantOrderId, status: "rejected" },
    });
    expect(res.status).toBe(200);

    const { data: notifications, error } = await db
      .from("notifications")
      .select("title, body, is_read")
      .eq("user_id", customerUserId)
      .eq("type", "order_rejected")
      .order("created_at", { ascending: false })
      .limit(1);

    expect(error).toBeNull();
    expect(notifications).toHaveLength(1);
    const notification = notifications![0];
    expect(notification.title).toBe("Order declined");
    // Template variables actually substituted, not left as literal {{...}}.
    expect(notification.body).toContain("QA TEST — Merchant A — DO NOT USE");
    expect(notification.body).toContain(merchantOrderId.slice(0, 8));
    expect(notification.body).not.toContain("{{");
    expect(notification.is_read).toBe(false);
  });
});
