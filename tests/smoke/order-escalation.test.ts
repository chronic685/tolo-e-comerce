import { afterEach, beforeAll, describe, expect, inject, it } from "vitest";
import { env, serviceClient, signIn } from "../env.ts";

// Phase 4: escalate_unacknowledged_orders() (migration 0033). Every test
// here creates its own disposable merchant_order rather than reusing the
// shared QA fixture order from ensureQaFixtures.ts — that order is relied
// on by tests/smoke/merchant-authorization.test.ts to stay in "new" status
// forever, and (per section 18 of this phase's brief) new mutable state
// should be its own unique records, not more load on shared fixtures.
// It's naturally exempt from escalation anyway: it was created directly via
// create_order() rather than through payment-webhook, so it has no
// notification_sent_at, which escalate_unacknowledged_orders() requires.
//
// escalate_unacknowledged_orders() is global — it sweeps every eligible row
// in the table, not just ones this suite created — so these tests read
// back only the specific order(s) they created rather than asserting
// anything about the function's total return count.
const db = serviceClient();

async function createDisposableOrder(customerUserId: string, addressId: string, variantId: string): Promise<string> {
  const { data: orderId, error } = await db.rpc("create_order", {
    p_customer_id: customerUserId,
    p_address_id: addressId,
    p_items: [{ variant_id: variantId, quantity: 1 }],
  });
  if (error) throw error;
  const { data: mo, error: moError } = await db.from("merchant_orders").select("id").eq("order_id", orderId as string).single();
  if (moError) throw moError;
  return mo.id;
}

async function setNotificationSentMinutesAgo(merchantOrderId: string, minutesAgo: number) {
  const { error } = await db
    .from("merchant_orders")
    .update({ notification_sent_at: new Date(Date.now() - minutesAgo * 60_000).toISOString() })
    .eq("id", merchantOrderId);
  if (error) throw error;
}

async function getEscalationConfig(): Promise<{ escalate_after_minutes: number } & Record<string, unknown>> {
  const { data } = await db.from("system_settings").select("value").eq("key", "merchant_new_order_alerts").single();
  return data!.value as { escalate_after_minutes: number };
}

async function runEscalationJob(): Promise<number> {
  const { data, error } = await db.rpc("escalate_unacknowledged_orders");
  if (error) throw error;
  return data as number;
}

async function readMerchantOrder(id: string) {
  const { data, error } = await db.from("merchant_orders").select("status, escalated_at, order_received_at, notification_sent_at").eq("id", id).single();
  if (error) throw error;
  return data;
}

describe("order escalation: escalate_unacknowledged_orders()", () => {
  let addressId: string;
  let variantId: string;
  let customerUserId: string;
  const createdOrders: string[] = [];

  beforeAll(() => {
    const fixtures = inject("qaFixtures");
    addressId = fixtures.addressId;
    variantId = fixtures.variantId;
    customerUserId = fixtures.customerUserId;
  });

  afterEach(async () => {
    // These disposable orders reserved real stock via create_order() — they
    // aren't deleted (this system treats orders as an append-only audit
    // trail, same as everywhere else in the test suite), but resetting
    // status to something terminal keeps them out of every future run's
    // eligibility window regardless of what escalate_after_minutes becomes.
    if (createdOrders.length > 0) {
      await db.from("merchant_orders").update({ status: "cancelled" }).in("id", createdOrders);
      createdOrders.length = 0;
    }
  });

  it("Test A — below threshold: a recently-notified order is not escalated", async () => {
    const config = await getEscalationConfig();
    const orderId = await createDisposableOrder(customerUserId, addressId, variantId);
    createdOrders.push(orderId);
    await setNotificationSentMinutesAgo(orderId, Math.max(0, config.escalate_after_minutes - 1));

    await runEscalationJob();

    const row = await readMerchantOrder(orderId);
    expect(row.escalated_at).toBeNull();
  });

  it("Test B — threshold exceeded: an overdue order is escalated and Operations is notified", async () => {
    const config = await getEscalationConfig();
    const orderId = await createDisposableOrder(customerUserId, addressId, variantId);
    createdOrders.push(orderId);
    await setNotificationSentMinutesAgo(orderId, config.escalate_after_minutes + 5);

    const before = await db.from("notifications").select("id", { count: "exact", head: true }).eq("type", "order_unacknowledged_escalated");

    await runEscalationJob();

    const row = await readMerchantOrder(orderId);
    expect(row.escalated_at).not.toBeNull();

    const after = await db.from("notifications").select("id", { count: "exact", head: true }).eq("type", "order_unacknowledged_escalated");
    expect(after.count!).toBeGreaterThan(before.count!);
  });

  it("Test C — already acknowledged: an order with order_received_at set is never escalated", async () => {
    const config = await getEscalationConfig();
    const orderId = await createDisposableOrder(customerUserId, addressId, variantId);
    createdOrders.push(orderId);
    await db
      .from("merchant_orders")
      .update({ status: "accepted", order_received_at: new Date().toISOString() })
      .eq("id", orderId);
    await setNotificationSentMinutesAgo(orderId, config.escalate_after_minutes + 30);

    await runEscalationJob();

    const row = await readMerchantOrder(orderId);
    expect(row.escalated_at).toBeNull();
  });

  it("Test D — idempotency: running the job twice escalates once, not twice", async () => {
    const config = await getEscalationConfig();
    const orderId = await createDisposableOrder(customerUserId, addressId, variantId);
    createdOrders.push(orderId);
    await setNotificationSentMinutesAgo(orderId, config.escalate_after_minutes + 5);

    await runEscalationJob();
    const firstRun = await readMerchantOrder(orderId);
    expect(firstRun.escalated_at).not.toBeNull();

    const countAfterFirst = await db
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("type", "order_unacknowledged_escalated")
      .gte("created_at", new Date(Date.now() - 60_000).toISOString());

    await runEscalationJob();
    const secondRun = await readMerchantOrder(orderId);
    expect(secondRun.escalated_at).toEqual(firstRun.escalated_at);

    const countAfterSecond = await db
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("type", "order_unacknowledged_escalated")
      .gte("created_at", new Date(Date.now() - 60_000).toISOString());
    expect(countAfterSecond.count).toBe(countAfterFirst.count);
  });

  it("Test E — multiple eligible orders are each escalated independently in one run", async () => {
    const config = await getEscalationConfig();
    const orderA = await createDisposableOrder(customerUserId, addressId, variantId);
    const orderB = await createDisposableOrder(customerUserId, addressId, variantId);
    createdOrders.push(orderA, orderB);
    await setNotificationSentMinutesAgo(orderA, config.escalate_after_minutes + 5);
    await setNotificationSentMinutesAgo(orderB, config.escalate_after_minutes + 5);

    await runEscalationJob();

    const rowA = await readMerchantOrder(orderA);
    const rowB = await readMerchantOrder(orderB);
    expect(rowA.escalated_at).not.toBeNull();
    expect(rowB.escalated_at).not.toBeNull();
  });

  it("Test F — configuration is actually respected, including a malformed/disabled value failing safe", async () => {
    const { data: original } = await db.from("system_settings").select("value").eq("key", "merchant_new_order_alerts").single();

    const orderId = await createDisposableOrder(customerUserId, addressId, variantId);
    createdOrders.push(orderId);
    // 100 minutes overdue by any sane threshold.
    await setNotificationSentMinutesAgo(orderId, 100);

    try {
      // A malformed/non-positive threshold must never escalate everything —
      // it must fail safe and escalate nothing.
      await db.from("system_settings").update({ value: { ...original!.value, escalate_after_minutes: -5 } }).eq("key", "merchant_new_order_alerts");
      await runEscalationJob();
      expect((await readMerchantOrder(orderId)).escalated_at).toBeNull();

      // A tight, explicit threshold (2 minutes) must now catch this same
      // 100-minutes-overdue order, proving the configured value is what's
      // actually driving the decision, not a hard-coded number.
      await db.from("system_settings").update({ value: { ...original!.value, escalate_after_minutes: 2 } }).eq("key", "merchant_new_order_alerts");
      await runEscalationJob();
      expect((await readMerchantOrder(orderId)).escalated_at).not.toBeNull();
    } finally {
      await db.from("system_settings").update({ value: original!.value }).eq("key", "merchant_new_order_alerts");
    }
  });

  it("Test G — late acknowledgement after escalation preserves escalation history", async () => {
    const config = await getEscalationConfig();
    const orderId = await createDisposableOrder(customerUserId, addressId, variantId);
    createdOrders.push(orderId);
    await setNotificationSentMinutesAgo(orderId, config.escalate_after_minutes + 5);

    await runEscalationJob();
    const escalated = await readMerchantOrder(orderId);
    expect(escalated.escalated_at).not.toBeNull();

    // The merchant acknowledges after the fact — order-status's real
    // behavior is already covered elsewhere; this only asserts that doing
    // so does not erase the escalation record.
    await db.from("merchant_orders").update({ status: "accepted", order_received_at: new Date().toISOString() }).eq("id", orderId);

    const acknowledged = await readMerchantOrder(orderId);
    expect(acknowledged.escalated_at).toEqual(escalated.escalated_at);
    expect(acknowledged.order_received_at).not.toBeNull();
  });

  it("Test H — no customer, merchant, or anon caller can invoke the escalation job directly", async () => {
    const merchantAToken = await signIn(env.qaMerchantAEmail, env.qaMerchantAPassword);
    const customerToken = await signIn(env.qaCustomerEmail, env.qaCustomerPassword);

    for (const token of [merchantAToken, customerToken, env.anonKey]) {
      const res = await fetch(`${env.supabaseUrl}/rest/v1/rpc/escalate_unacknowledged_orders`, {
        method: "POST",
        headers: { apikey: env.anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: "{}",
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }
  });

  it("Test I — concurrent execution cannot double-escalate the same order", async () => {
    const config = await getEscalationConfig();
    const orderId = await createDisposableOrder(customerUserId, addressId, variantId);
    createdOrders.push(orderId);
    await setNotificationSentMinutesAgo(orderId, config.escalate_after_minutes + 5);

    const beforeCount = (
      await db
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("type", "order_unacknowledged_escalated")
        .gte("created_at", new Date(Date.now() - 60_000).toISOString())
    ).count!;

    // Same recipient rule as escalate_unacknowledged_orders() (migration
    // 0051): active admins, plus active staff with the Orders page.
    const { data: activeProfiles } = await db
      .from("profiles")
      .select("role, admin_tier, permissions")
      .eq("account_status", "active")
      .or("admin_tier.not.is.null,permissions.cs.[\"orders\"]");
    const recipientCount = (activeProfiles ?? []).filter(
      (p) => p.admin_tier !== null || (String(p.role).startsWith("tolo_") && (p.permissions as string[]).includes("orders")),
    ).length;

    // Two "workers" racing to claim the same overdue order.
    await Promise.all([runEscalationJob(), runEscalationJob()]);

    const row = await readMerchantOrder(orderId);
    expect(row.escalated_at).not.toBeNull();

    const afterCount = (
      await db
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("type", "order_unacknowledged_escalated")
        .gte("created_at", new Date(Date.now() - 60_000).toISOString())
    ).count!;
    // Exactly one notification per Operations recipient — i.e. exactly one
    // escalation happened, not two — proves the atomic UPDATE ... WHERE
    // escalated_at IS NULL claim let only one of the two concurrent runs
    // win this specific row. (There can legitimately be more than one
    // recipient — every active admin and Orders-page staff member is notified —
    // so the invariant is "one escalation's worth", not literally "1".)
    expect(afterCount - beforeCount).toBe(recipientCount);
  });
});
