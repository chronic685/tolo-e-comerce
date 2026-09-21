import { afterEach, describe, expect, inject, it } from "vitest";
import { serviceClient } from "../env.ts";

// Migration 0046: customer-facing promo codes on top of the existing
// scope-based automatic discounts. Covers resolve_best_discount()'s new
// optional p_code argument, the uppercase-normalization trigger, the
// unique-code constraint, and validate_discount_code() (the preview
// function Checkout.tsx calls before an order is ever created).
function isNoDiscount(data: unknown): boolean {
  return data === null || (typeof data === "object" && data !== null && (data as { id: unknown }).id === null);
}

describe("promo codes", () => {
  const db = serviceClient();
  let insertedRuleIds: string[] = [];

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
        name: "QA TEST promo — DO NOT USE",
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

  it("normalizes a code to uppercase/trimmed on insert", async () => {
    const rule = await insertRule({ code: "  save10  " });
    expect(rule.code).toBe("SAVE10");
  });

  it("enforces uniqueness on code case-insensitively (both stored uppercase)", async () => {
    await insertRule({ code: "UNIQUE10" });
    const { error } = await db.from("discount_rules").insert({
      name: "QA TEST promo dup — DO NOT USE",
      scope_type: "platform",
      discount_kind: "percent",
      amount: 5,
      is_active: true,
      funded_by: "tolo",
      code: "unique10",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/duplicate key|unique/i);
  });

  it("a coded rule is excluded from resolve_best_discount when no code (or the wrong code) is supplied", async () => {
    const fixtures = inject("qaFixtures");
    await insertRule({ code: "CODEONLY10", discount_kind: "percent", amount: 10 });

    const noCode = await db.rpc("resolve_best_discount", {
      p_customer_id: fixtures.customerUserId,
      p_merchant_ids: [fixtures.merchantAId],
      p_category_ids: [],
      p_product_ids: [],
      p_order_subtotal: 1000,
    });
    expect(isNoDiscount(noCode.data)).toBe(true);

    const wrongCode = await db.rpc("resolve_best_discount", {
      p_customer_id: fixtures.customerUserId,
      p_merchant_ids: [fixtures.merchantAId],
      p_category_ids: [],
      p_product_ids: [],
      p_order_subtotal: 1000,
      p_code: "NOTTHECODE",
    });
    expect(isNoDiscount(wrongCode.data)).toBe(true);
  });

  it("matches a coded rule case-insensitively when the right code is supplied", async () => {
    const fixtures = inject("qaFixtures");
    const rule = await insertRule({ code: "CODEONLY10", discount_kind: "percent", amount: 10 });

    const { data, error } = await db.rpc("resolve_best_discount", {
      p_customer_id: fixtures.customerUserId,
      p_merchant_ids: [fixtures.merchantAId],
      p_category_ids: [],
      p_product_ids: [],
      p_order_subtotal: 1000,
      p_code: "codeonly10",
    });
    expect(error).toBeNull();
    expect(data.id).toBe(rule.id);
  });

  it("best-of: the bigger automatic discount wins over a smaller code, even when the code matches", async () => {
    const fixtures = inject("qaFixtures");
    await insertRule({ discount_kind: "percent", amount: 20 }); // automatic, no code
    const coded = await insertRule({ code: "SMALLCODE", discount_kind: "percent", amount: 5 });

    const { data } = await db.rpc("resolve_best_discount", {
      p_customer_id: fixtures.customerUserId,
      p_merchant_ids: [fixtures.merchantAId],
      p_category_ids: [],
      p_product_ids: [],
      p_order_subtotal: 1000,
      p_code: "SMALLCODE",
    });
    // The 20%-off automatic rule (200) beats the 5%-off coded rule (50) --
    // best-of, not code-overrides-automatic.
    expect(data.id).not.toBe(coded.id);
    expect(Number(data.amount)).toBe(20);
  });

  it("best-of: a bigger code beats a smaller automatic discount", async () => {
    const fixtures = inject("qaFixtures");
    await insertRule({ discount_kind: "percent", amount: 5 }); // automatic, no code
    const coded = await insertRule({ code: "BIGCODE", discount_kind: "percent", amount: 25 });

    const { data } = await db.rpc("resolve_best_discount", {
      p_customer_id: fixtures.customerUserId,
      p_merchant_ids: [fixtures.merchantAId],
      p_category_ids: [],
      p_product_ids: [],
      p_order_subtotal: 1000,
      p_code: "BIGCODE",
    });
    expect(data.id).toBe(coded.id);
  });

  it("a merchant-scoped code still only matches when that merchant is in the cart", async () => {
    const fixtures = inject("qaFixtures");
    await insertRule({ code: "MERCHANTCODE", scope_type: "merchant", scope_id: fixtures.merchantAId, discount_kind: "fixed", amount: 50 });

    const wrongMerchant = await db.rpc("resolve_best_discount", {
      p_customer_id: fixtures.customerUserId,
      p_merchant_ids: [fixtures.merchantBId],
      p_category_ids: [],
      p_product_ids: [],
      p_order_subtotal: 1000,
      p_code: "MERCHANTCODE",
    });
    expect(isNoDiscount(wrongMerchant.data)).toBe(true);

    const rightMerchant = await db.rpc("resolve_best_discount", {
      p_customer_id: fixtures.customerUserId,
      p_merchant_ids: [fixtures.merchantAId],
      p_category_ids: [],
      p_product_ids: [],
      p_order_subtotal: 1000,
      p_code: "MERCHANTCODE",
    });
    expect(isNoDiscount(rightMerchant.data)).toBe(false);
  });

  describe("validate_discount_code()", () => {
    it("reports 'invalid' for a code that doesn't exist", async () => {
      const { data, error } = await db
        .rpc("validate_discount_code", {
          p_code: "DOESNOTEXIST",
          p_merchant_ids: [],
          p_category_ids: [],
          p_product_ids: [],
          p_order_subtotal: 100,
        })
        .single();
      expect(error).toBeNull();
      expect(data.status).toBe("invalid");
    });

    it("reports 'invalid' for an inactive rule's code", async () => {
      await insertRule({ code: "INACTIVE10", is_active: false });
      const { data } = await db
        .rpc("validate_discount_code", {
          p_code: "INACTIVE10",
          p_merchant_ids: [],
          p_category_ids: [],
          p_product_ids: [],
          p_order_subtotal: 100,
        })
        .single();
      expect(data.status).toBe("invalid");
    });

    it("reports 'not_applicable' when the cart subtotal is below the rule's minimum", async () => {
      await insertRule({ code: "MINORDER500", min_order_value: 500 });
      const { data } = await db
        .rpc("validate_discount_code", {
          p_code: "MINORDER500",
          p_merchant_ids: [],
          p_category_ids: [],
          p_product_ids: [],
          p_order_subtotal: 100,
        })
        .single();
      expect(data.status).toBe("not_applicable");
    });

    it("reports 'valid' with the computed discount amount for an eligible code (matched case-insensitively)", async () => {
      await insertRule({ code: "PREVIEW10", discount_kind: "percent", amount: 10 });
      const { data, error } = await db
        .rpc("validate_discount_code", {
          p_code: "preview10",
          p_merchant_ids: [],
          p_category_ids: [],
          p_product_ids: [],
          p_order_subtotal: 1000,
        })
        .single();
      expect(error).toBeNull();
      expect(data.status).toBe("valid");
      expect(Number(data.discount_amount)).toBe(100);
      expect(data.rule_name).toBe("QA TEST promo — DO NOT USE");
    });

    it("is callable by anon (Checkout.tsx calls it directly, unauthenticated has no session but must not error)", async () => {
      const { error } = await db
        .rpc("validate_discount_code", {
          p_code: "ANYTHING",
          p_merchant_ids: [],
          p_category_ids: [],
          p_product_ids: [],
          p_order_subtotal: 100,
        })
        .single();
      expect(error).toBeNull();
    });
  });
});
