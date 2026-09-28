import { afterEach, beforeAll, describe, expect, inject, it } from "vitest";
import { env, serviceClient, signIn } from "../env.ts";

// Group 1, item 4: stores.status ('active'/'paused'/...) and
// operating_hours (migration 0003) existed but were never enforced --
// create_order() only ever checked merchants.status. Migration 0057 adds
// store_is_open_now() and wires it into create_order(). These tests drive
// the real create_order() RPC (same as checkout does), not a
// reimplementation of the check, against the QA merchant A store fixture.
const db = serviceClient();

async function attemptOrder(customerUserId: string, addressId: string, variantId: string) {
  return db.rpc("create_order", {
    p_customer_id: customerUserId,
    p_address_id: addressId,
    p_items: [{ variant_id: variantId, quantity: 1 }],
  });
}

describe("store hours + pause enforcement (migration 0057)", () => {
  let customerUserId: string;
  let addressId: string;
  let variantId: string;
  let storeId: string;
  let originalStatus: string;
  let originalHours: unknown;

  beforeAll(async () => {
    await signIn(env.qaCustomerEmail, env.qaCustomerPassword);
    const fixtures = inject("qaFixtures");
    customerUserId = fixtures.customerUserId;
    addressId = fixtures.addressId;
    variantId = fixtures.variantId;

    // The QA merchant A store fixture -- resolved via the variant's own
    // product -> merchant chain rather than assumed, so this doesn't
    // silently test the wrong store if fixtures ever change shape.
    const { data: variant, error } = await db
      .from("product_variants")
      .select("products ( merchant_id )")
      .eq("id", variantId)
      .single();
    expect(error).toBeNull();
    const merchantId = (variant as unknown as { products: { merchant_id: string } }).products.merchant_id;

    const { data: store, error: storeError } = await db
      .from("stores")
      .select("id, status, operating_hours")
      .eq("merchant_id", merchantId)
      .maybeSingle();
    expect(storeError).toBeNull();
    expect(store, "QA merchant A must have a stores row for this test -- check ensureQaFixtures.ts").not.toBeNull();
    storeId = store!.id;
    originalStatus = store!.status;
    originalHours = store!.operating_hours;
  });

  afterEach(async () => {
    // Every test mutates the shared QA store's status/hours -- restore
    // immediately after each one so tests never leak state into each other
    // or into unrelated test files that also use this fixture.
    await db.from("stores").update({ status: originalStatus, operating_hours: originalHours }).eq("id", storeId);
  });

  it("blocks checkout when the store is paused", async () => {
    await db.from("stores").update({ status: "paused" }).eq("id", storeId);

    const { error } = await attemptOrder(customerUserId, addressId, variantId);
    expect(error).not.toBeNull();
    expect(error!.message).toContain("currently closed for new orders");
  });

  it("allows checkout when the store is active with no hours configured", async () => {
    await db.from("stores").update({ status: "active", operating_hours: {} }).eq("id", storeId);

    const { data, error } = await attemptOrder(customerUserId, addressId, variantId);
    expect(error).toBeNull();
    expect(data).toBeTruthy();
  });

  it("blocks checkout when today's hours don't cover right now", async () => {
    // A window that (barring an extraordinarily unlucky test run at
    // exactly midnight Addis Ababa time) cannot include the current
    // moment: 00:00-00:01, applied to every day of the week.
    const alwaysClosedToday = { open: "00:00", close: "00:01" };
    await db
      .from("stores")
      .update({
        status: "active",
        operating_hours: { sun: alwaysClosedToday, mon: alwaysClosedToday, tue: alwaysClosedToday, wed: alwaysClosedToday, thu: alwaysClosedToday, fri: alwaysClosedToday, sat: alwaysClosedToday },
      })
      .eq("id", storeId);

    const { error } = await attemptOrder(customerUserId, addressId, variantId);
    expect(error).not.toBeNull();
    expect(error!.message).toContain("currently closed for new orders");
  });

  it("allows checkout when today's hours cover a full 24h window", async () => {
    const alwaysOpenToday = { open: "00:00", close: "23:59" };
    await db
      .from("stores")
      .update({
        status: "active",
        operating_hours: { sun: alwaysOpenToday, mon: alwaysOpenToday, tue: alwaysOpenToday, wed: alwaysOpenToday, thu: alwaysOpenToday, fri: alwaysOpenToday, sat: alwaysOpenToday },
      })
      .eq("id", storeId);

    const { data, error } = await attemptOrder(customerUserId, addressId, variantId);
    expect(error).toBeNull();
    expect(data).toBeTruthy();
  });

  it("the customer-facing storefront query resolves is_open_now (store_is_open_now as a computed column)", async () => {
    await db.from("stores").update({ status: "paused" }).eq("id", storeId);
    const { data: pausedRow, error: pausedError } = await db
      .from("stores")
      .select("status, is_open_now:store_is_open_now")
      .eq("id", storeId)
      .single();
    expect(pausedError).toBeNull();
    expect(pausedRow!.is_open_now).toBe(false);

    await db.from("stores").update({ status: "active", operating_hours: {} }).eq("id", storeId);
    const { data: activeRow, error: activeError } = await db
      .from("stores")
      .select("status, is_open_now:store_is_open_now")
      .eq("id", storeId)
      .single();
    expect(activeError).toBeNull();
    expect(activeRow!.is_open_now).toBe(true);
  });
});
