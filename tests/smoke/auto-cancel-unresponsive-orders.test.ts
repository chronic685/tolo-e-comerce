import { afterEach, beforeAll, describe, expect, inject, it } from "vitest";
import { env, serviceClient, signIn } from "../env.ts";
import { callFunction } from "../helpers.ts";

// Group 1, item 5 (migration 0058): verified there was previously no
// backstop that actually resolved an order a merchant never responded to
// -- escalate_unacknowledged_orders() (migration 0033) only ever notified
// Tolo ops, forever. auto_cancel_unresponsive_orders() adds one, on its
// own separately-configurable timeout (system_settings.auto_cancel_unresponsive_orders).
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

async function setNotificationSentMinutesAgo(merchantOrderId: string, minutesAgo: number) {
  const { error } = await db
    .from("merchant_orders")
    .update({ notification_sent_at: new Date(Date.now() - minutesAgo * 60_000).toISOString() })
    .eq("id", merchantOrderId);
  if (error) throw error;
}

async function markPaidViaCashOnDelivery(orderId: string, staffToken: string) {
  const { data: payment, error } = await db.from("payments").insert({ order_id: orderId, provider: "cash_on_delivery", amount: 1 }).select().single();
  if (error) throw error;
  const res = await callFunction("confirm-payment", { token: staffToken, body: { payment_id: payment.id } });
  if (res.status !== 200) throw new Error(`confirm-payment failed: ${res.status}`);
}

async function runAutoCancelJob(): Promise<number> {
  const { data, error } = await db.rpc("auto_cancel_unresponsive_orders");
  if (error) throw error;
  return data as number;
}

async function getConfig() {
  const { data } = await db.from("system_settings").select("value").eq("key", "auto_cancel_unresponsive_orders").single();
  return data!.value as { enabled: boolean; after_minutes: number };
}

describe("auto-cancel unresponsive orders (migration 0058)", () => {
  let staffToken: string;
  let customerUserId: string;
  let addressId: string;
  let variantId: string;
  const restoreConfig: (() => Promise<void>)[] = [];

  beforeAll(async () => {
    staffToken = await signIn(env.qaStaffEmail, env.qaStaffPassword);
    const fixtures = inject("qaFixtures");
    customerUserId = fixtures.customerUserId;
    addressId = fixtures.addressId;
    variantId = fixtures.variantId;
  });

  afterEach(async () => {
    while (restoreConfig.length > 0) {
      const restore = restoreConfig.pop()!;
      await restore();
    }
  });

  it("cancels and refunds a paid order whose merchant never acknowledged it past the configured timeout", async () => {
    const original = await getConfig();
    restoreConfig.push(() => db.from("system_settings").update({ value: original }).eq("key", "auto_cancel_unresponsive_orders").then(() => {}));
    await db.from("system_settings").update({ value: { enabled: true, after_minutes: 10 } }).eq("key", "auto_cancel_unresponsive_orders");

    const { orderId, merchantOrderId } = await createDisposableOrder(customerUserId, addressId, variantId);
    await markPaidViaCashOnDelivery(orderId, staffToken);
    await setNotificationSentMinutesAgo(merchantOrderId, 15);

    await runAutoCancelJob();

    const { data: mo, error } = await db.from("merchant_orders").select("status").eq("id", merchantOrderId).single();
    expect(error).toBeNull();
    expect(mo!.status).toBe("rejected");

    const { data: returns } = await db.from("returns").select("id, status").eq("merchant_order_id", merchantOrderId);
    expect(returns).toHaveLength(1);
    expect(returns![0].status).toBe("approved");
    const { data: refund } = await db.from("refunds").select("status").eq("return_id", returns![0].id).single();
    expect(refund!.status).toBe("pending");
  });

  it("does not touch an order still within the configured timeout window", async () => {
    const original = await getConfig();
    restoreConfig.push(() => db.from("system_settings").update({ value: original }).eq("key", "auto_cancel_unresponsive_orders").then(() => {}));
    await db.from("system_settings").update({ value: { enabled: true, after_minutes: 30 } }).eq("key", "auto_cancel_unresponsive_orders");

    const { merchantOrderId } = await createDisposableOrder(customerUserId, addressId, variantId);
    await setNotificationSentMinutesAgo(merchantOrderId, 5);

    await runAutoCancelJob();

    const { data: mo } = await db.from("merchant_orders").select("status").eq("id", merchantOrderId).single();
    expect(mo!.status).toBe("new");
  });

  it("is a no-op when disabled, even past the timeout", async () => {
    const original = await getConfig();
    restoreConfig.push(() => db.from("system_settings").update({ value: original }).eq("key", "auto_cancel_unresponsive_orders").then(() => {}));
    await db.from("system_settings").update({ value: { enabled: false, after_minutes: 10 } }).eq("key", "auto_cancel_unresponsive_orders");

    const { merchantOrderId } = await createDisposableOrder(customerUserId, addressId, variantId);
    await setNotificationSentMinutesAgo(merchantOrderId, 60);

    await runAutoCancelJob();

    const { data: mo } = await db.from("merchant_orders").select("status").eq("id", merchantOrderId).single();
    expect(mo!.status).toBe("new");
  });

  it("notifies the merchant owner with the order_auto_cancelled template", async () => {
    const original = await getConfig();
    restoreConfig.push(() => db.from("system_settings").update({ value: original }).eq("key", "auto_cancel_unresponsive_orders").then(() => {}));
    await db.from("system_settings").update({ value: { enabled: true, after_minutes: 10 } }).eq("key", "auto_cancel_unresponsive_orders");

    const { merchantOrderId } = await createDisposableOrder(customerUserId, addressId, variantId);
    await setNotificationSentMinutesAgo(merchantOrderId, 15);

    const { data: mo } = await db.from("merchant_orders").select("merchant_id").eq("id", merchantOrderId).single();
    const { data: merchant } = await db.from("merchants").select("owner_id").eq("id", mo!.merchant_id).single();

    await runAutoCancelJob();

    const { data: notifications, error } = await db
      .from("notifications")
      .select("body")
      .eq("user_id", merchant!.owner_id)
      .eq("type", "order_auto_cancelled")
      .order("created_at", { ascending: false })
      .limit(1);
    expect(error).toBeNull();
    expect(notifications).toHaveLength(1);
    expect(notifications![0].body).not.toContain("{{");
  });
});
