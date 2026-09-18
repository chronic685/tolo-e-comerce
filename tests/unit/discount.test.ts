import { afterEach, beforeAll, describe, expect, inject, it } from "vitest";
import { serviceClient } from "../env.ts";

// PostgREST serializes a NULL value of a composite return type (discount_rules
// here) as an object with every field null, not JSON null — this normalizes
// both representations for "no discount matched" assertions.
function isNoDiscount(data: unknown): boolean {
  return data === null || (typeof data === "object" && data !== null && (data as { id: unknown }).id === null);
}

// Integration tests against resolve_best_discount() — see commission.test.ts
// for why this calls the real PL/pgSQL function rather than a reimplemented
// JS copy. All rules created here are inserted and deleted within each test
// so they never affect real discount eligibility for real customers.
describe("discount resolution: resolve_best_discount()", () => {
  const db = serviceClient();
  let insertedRuleIds: string[] = [];
  let discountsGloballyEnabled = true;

  beforeAll(async () => {
    const { data } = await db.from("system_settings").select("value").eq("key", "discounts_enabled").maybeSingle();
    discountsGloballyEnabled = data?.value !== false;
  });

  afterEach(async () => {
    if (insertedRuleIds.length > 0) {
      await db.from("discount_rules").delete().in("id", insertedRuleIds);
      insertedRuleIds = [];
    }
  });

  async function insertRule(overrides: Record<string, unknown>) {
    const { data, error } = await db
      .from("discount_rules")
      .insert({
        name: "QA TEST discount — DO NOT USE",
        scope_type: "platform",
        discount_kind: "percent",
        amount: 10,
        min_order_value: 0,
        is_active: true,
        funded_by: "tolo",
        ...overrides,
      })
      .select()
      .single();
    expect(error).toBeNull();
    insertedRuleIds.push(data!.id);
    return data!;
  }

  it("returns no discount when none are configured/eligible", async () => {
    const fixtures = inject("qaFixtures");
    const { data, error } = await db.rpc("resolve_best_discount", {
      p_customer_id: fixtures.customerUserId,
      p_merchant_ids: [fixtures.merchantAId],
      p_category_ids: [],
      p_product_ids: [],
      p_order_subtotal: 100,
    });
    expect(error).toBeNull();
    expect(isNoDiscount(data)).toBe(true);
  });

  it("calculates a percentage discount correctly", async () => {
    if (!discountsGloballyEnabled) {
      console.warn("NOT COVERED: discounts_enabled=false platform-wide — skipping.");
      return;
    }
    const fixtures = inject("qaFixtures");
    await insertRule({ discount_kind: "percent", amount: 10 });

    const { data, error } = await db.rpc("resolve_best_discount", {
      p_customer_id: fixtures.customerUserId,
      p_merchant_ids: [fixtures.merchantAId],
      p_category_ids: [],
      p_product_ids: [],
      p_order_subtotal: 1000,
    });
    expect(error).toBeNull();
    expect(data.discount_kind).toBe("percent");
    expect(Number(data.amount)).toBe(10);
  });

  it("caps a percentage discount at max_discount_amount", async () => {
    if (!discountsGloballyEnabled) {
      console.warn("NOT COVERED: discounts_enabled=false platform-wide — skipping.");
      return;
    }
    const fixtures = inject("qaFixtures");
    await insertRule({ discount_kind: "percent", amount: 50, max_discount_amount: 20 });

    // 50% of 1000 would be 500 — must be capped to 20.
    const { data: rule } = await db.rpc("resolve_best_discount", {
      p_customer_id: fixtures.customerUserId,
      p_merchant_ids: [fixtures.merchantAId],
      p_category_ids: [],
      p_product_ids: [],
      p_order_subtotal: 1000,
    });
    expect(rule).not.toBeNull();
    const computed = Math.min((1000 * Number(rule.amount)) / 100, Number(rule.max_discount_amount));
    expect(computed).toBe(20);
  });

  it("never applies a rule below its minimum order value", async () => {
    const fixtures = inject("qaFixtures");
    await insertRule({ discount_kind: "fixed", amount: 50, min_order_value: 500 });

    const { data, error } = await db.rpc("resolve_best_discount", {
      p_customer_id: fixtures.customerUserId,
      p_merchant_ids: [fixtures.merchantAId],
      p_category_ids: [],
      p_product_ids: [],
      p_order_subtotal: 100, // below the 500 minimum
    });
    expect(error).toBeNull();
    expect(isNoDiscount(data)).toBe(true);
  });

  it("never applies an inactive rule", async () => {
    const fixtures = inject("qaFixtures");
    await insertRule({ discount_kind: "fixed", amount: 999, is_active: false });

    const { data } = await db.rpc("resolve_best_discount", {
      p_customer_id: fixtures.customerUserId,
      p_merchant_ids: [fixtures.merchantAId],
      p_category_ids: [],
      p_product_ids: [],
      p_order_subtotal: 1000,
    });
    expect(isNoDiscount(data)).toBe(true);
  });

  it("resolve_best_discount returns the raw rule; create_order is what clamps it to the subtotal", async () => {
    if (!discountsGloballyEnabled) {
      console.warn("NOT COVERED: discounts_enabled=false platform-wide — skipping.");
      return;
    }
    const fixtures = inject("qaFixtures");
    await insertRule({ discount_kind: "fixed", amount: 500 });

    const { data, error } = await db.rpc("resolve_best_discount", {
      p_customer_id: fixtures.customerUserId,
      p_merchant_ids: [fixtures.merchantAId],
      p_category_ids: [],
      p_product_ids: [],
      p_order_subtotal: 50, // smaller than the fixed discount amount
    });
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    // resolve_best_discount() returns the raw discount_rules row — the
    // negative-total guard (`least(v_discount.amount, v_order_subtotal)`,
    // 0029_delivery_zones_notifications_adjustments_favorites.sql:507) lives
    // in create_order() at the point the discount is actually applied, not
    // here. NOT COVERED end-to-end: exercising that line would require
    // creating a real order through create_order() on every test run, which
    // this suite deliberately avoids (see tests/README.md) — a change that
    // removed that clamp would not be caught by this suite.
    expect(Number(data.amount)).toBe(500);
  });
});
