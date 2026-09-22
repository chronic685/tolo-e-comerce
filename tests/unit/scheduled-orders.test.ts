import { afterEach, beforeAll, describe, expect, inject, it } from "vitest";
import { serviceClient } from "../env.ts";

// Migration 0048: scheduled orders. Covers create_order()'s validation
// (master toggle, past/too-soon/too-far-out rejection) and
// escalate_unacknowledged_orders()'s exemption for a scheduled order that
// hasn't reached its delivery window yet — see order-escalation.test.ts for
// the pre-existing escalation-mechanics coverage this doesn't repeat.
describe("scheduled orders", () => {
  const db = serviceClient();
  const createdOrders: string[] = [];

  let addressId: string;
  let variantId: string;
  let customerUserId: string;

  beforeAll(() => {
    const fixtures = inject("qaFixtures");
    addressId = fixtures.addressId;
    variantId = fixtures.variantId;
    customerUserId = fixtures.customerUserId;
  });

  afterEach(async () => {
    // Append-only audit trail, same convention as order-escalation.test.ts —
    // move any disposable order to a terminal status rather than deleting.
    if (createdOrders.length > 0) {
      await db.from("merchant_orders").update({ status: "cancelled" }).in("order_id", createdOrders);
      createdOrders.length = 0;
    }
  });

  async function withScheduledOrdersEnabled<T>(fn: () => Promise<T>): Promise<T> {
    const { data: settings } = await db.from("system_settings").select("value").eq("key", "customer_features").single();
    const original = settings!.value;
    try {
      await db.from("system_settings").update({ value: { ...original, scheduled_orders_enabled: true } }).eq("key", "customer_features");
      return await fn();
    } finally {
      await db.from("system_settings").update({ value: original }).eq("key", "customer_features");
    }
  }

  async function createOrder(scheduledFor: string | null) {
    return db.rpc("create_order", {
      p_customer_id: customerUserId,
      p_address_id: addressId,
      p_items: [{ variant_id: variantId, quantity: 1 }],
      p_scheduled_for: scheduledFor,
    });
  }

  it("rejects a scheduled time when scheduled_orders_enabled is off (frontend convenience is not the security boundary)", async () => {
    const { data: settings } = await db.from("system_settings").select("value").eq("key", "customer_features").single();
    const original = settings!.value;
    try {
      await db.from("system_settings").update({ value: { ...original, scheduled_orders_enabled: false } }).eq("key", "customer_features");
      const { error } = await createOrder(new Date(Date.now() + 3 * 3_600_000).toISOString());
      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/not currently available/i);
    } finally {
      await db.from("system_settings").update({ value: original }).eq("key", "customer_features");
    }
  });

  it("rejects a scheduled time in the past", async () => {
    await withScheduledOrdersEnabled(async () => {
      const { error } = await createOrder(new Date(Date.now() - 3_600_000).toISOString());
      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/at least .* minutes from now/i);
    });
  });

  it("rejects a scheduled time closer than the minimum lead time", async () => {
    await withScheduledOrdersEnabled(async () => {
      const { data: bounds } = await db.from("system_settings").select("value").eq("key", "scheduled_orders").single();
      const minLead = (bounds!.value as { min_lead_minutes: number }).min_lead_minutes;
      const { error } = await createOrder(new Date(Date.now() + (minLead - 1) * 60_000).toISOString());
      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/at least .* minutes from now/i);
    });
  });

  it("rejects a scheduled time beyond the maximum advance window", async () => {
    await withScheduledOrdersEnabled(async () => {
      const { data: bounds } = await db.from("system_settings").select("value").eq("key", "scheduled_orders").single();
      const maxAdvance = (bounds!.value as { max_advance_days: number }).max_advance_days;
      const { error } = await createOrder(new Date(Date.now() + (maxAdvance + 1) * 86_400_000).toISOString());
      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/within the next .* days/i);
    });
  });

  it("accepts a valid scheduled time and persists it on both orders and merchant_orders", async () => {
    await withScheduledOrdersEnabled(async () => {
      const scheduledFor = new Date(Date.now() + 2 * 3_600_000).toISOString();
      const { data: orderId, error } = await createOrder(scheduledFor);
      expect(error).toBeNull();
      createdOrders.push(orderId as string);

      const { data: order } = await db.from("orders").select("scheduled_for").eq("id", orderId as string).single();
      expect(new Date(order!.scheduled_for).getTime()).toBe(new Date(scheduledFor).getTime());

      const { data: mo } = await db.from("merchant_orders").select("scheduled_for").eq("order_id", orderId as string).single();
      expect(new Date(mo!.scheduled_for).getTime()).toBe(new Date(scheduledFor).getTime());
    });
  });

  it("a null scheduled_for still works exactly as before (as-soon-as-possible, unaffected)", async () => {
    const { data: orderId, error } = await createOrder(null);
    expect(error).toBeNull();
    createdOrders.push(orderId as string);
    const { data: order } = await db.from("orders").select("scheduled_for").eq("id", orderId as string).single();
    expect(order!.scheduled_for).toBeNull();
  });

  describe("escalate_unacknowledged_orders() exemption for scheduled orders", () => {
    async function setNotificationSentMinutesAgo(merchantOrderId: string, minutesAgo: number) {
      await db
        .from("merchant_orders")
        .update({ notification_sent_at: new Date(Date.now() - minutesAgo * 60_000).toISOString() })
        .eq("id", merchantOrderId);
    }

    async function getMerchantOrderId(orderId: string) {
      const { data } = await db.from("merchant_orders").select("id").eq("order_id", orderId).single();
      return data!.id as string;
    }

    it("does not escalate a scheduled order whose delivery window is still far away, even though it's otherwise overdue", async () => {
      const config = (await db.from("system_settings").select("value").eq("key", "merchant_new_order_alerts").single()).data!.value as {
        escalate_after_minutes: number;
      };

      const { data: orderId, error } = await withScheduledOrdersEnabled(() =>
        createOrder(new Date(Date.now() + 5 * 86_400_000).toISOString()),
      );
      expect(error).toBeNull();
      createdOrders.push(orderId as string);

      const moId = await getMerchantOrderId(orderId as string);
      await setNotificationSentMinutesAgo(moId, config.escalate_after_minutes + 100); // very overdue by the old rule

      await db.rpc("escalate_unacknowledged_orders");

      const { data: row } = await db.from("merchant_orders").select("escalated_at").eq("id", moId).single();
      expect(row!.escalated_at).toBeNull();
    });

    it("escalates a scheduled order once its delivery window is within the escalation threshold", async () => {
      const config = (await db.from("system_settings").select("value").eq("key", "merchant_new_order_alerts").single()).data!.value as {
        escalate_after_minutes: number;
      };

      const { data: realOrderId, error } = await withScheduledOrdersEnabled(() =>
        createOrder(new Date(Date.now() + 61 * 60_000).toISOString()),
      );
      expect(error).toBeNull();
      createdOrders.push(realOrderId as string);

      const moId = await getMerchantOrderId(realOrderId as string);
      // Move the scheduled time to just inside the escalation window, and
      // make it look overdue by the notification-sent rule too — both
      // conditions must hold for escalation to fire.
      await db
        .from("merchant_orders")
        .update({ scheduled_for: new Date(Date.now() + Math.max(0, config.escalate_after_minutes - 1) * 60_000).toISOString() })
        .eq("id", moId);
      await setNotificationSentMinutesAgo(moId, config.escalate_after_minutes + 5);

      await db.rpc("escalate_unacknowledged_orders");

      const { data: row } = await db.from("merchant_orders").select("escalated_at").eq("id", moId).single();
      expect(row!.escalated_at).not.toBeNull();
    });
  });
});
