import { afterEach, beforeAll, describe, expect, inject, it } from "vitest";
import { env, serviceClient, signIn } from "../env.ts";
import { callFunction } from "../helpers.ts";

// Phase 3B regression: commission-calc must always agree with the
// authoritative get_commission_rate() RPC for the same inputs — there is
// now exactly one commission-resolution implementation (see
// supabase/functions/commission-calc/index.ts), so this test protects
// against a future edit accidentally reintroducing a second one.
describe("commission-calc agrees with get_commission_rate() RPC", () => {
  const db = serviceClient();
  let merchantAToken: string;
  let insertedRuleId: string | null = null;

  beforeAll(async () => {
    merchantAToken = await signIn(env.qaMerchantAEmail, env.qaMerchantAPassword);
  });

  afterEach(async () => {
    if (insertedRuleId) {
      await db.from("commission_rules").delete().eq("id", insertedRuleId);
      insertedRuleId = null;
    }
  });

  async function expectAgreement(merchantId: string, categoryId: string | null) {
    const { data: rpcRate, error: rpcError } = await db.rpc("get_commission_rate", {
      p_merchant_id: merchantId,
      p_category_id: categoryId,
    });
    expect(rpcError).toBeNull();

    const query: Record<string, string> = { merchant_id: merchantId };
    if (categoryId) query.category_id = categoryId;
    const res = await callFunction("commission-calc", { token: merchantAToken, query });
    expect(res.status).toBeLessThan(300);

    const body = res.json as { rate_percent?: number };
    expect(body.rate_percent).toBe(Number(rpcRate));
  }

  it("Case A — platform/default commission: commission-calc matches the RPC", async () => {
    const fixtures = inject("qaFixtures");
    await expectAgreement(fixtures.merchantAId, null);
  });

  it("Case B — merchant-specific commission: commission-calc matches the RPC", async () => {
    const fixtures = inject("qaFixtures");
    const { data, error } = await db
      .from("commission_rules")
      .insert({ scope_type: "merchant", scope_id: fixtures.merchantAId, rate_percent: 12.5, is_active: true })
      .select("id")
      .single();
    expect(error).toBeNull();
    insertedRuleId = data!.id;

    await expectAgreement(fixtures.merchantAId, null);
  });

  it("Case C — category-specific commission: commission-calc matches the RPC", async () => {
    const fixtures = inject("qaFixtures");
    const { data: category, error: categoryError } = await db.from("categories").select("id").limit(1).single();
    expect(categoryError).toBeNull();

    const { data, error } = await db
      .from("commission_rules")
      .insert({ scope_type: "category", scope_id: category!.id, rate_percent: 8, is_active: true })
      .select("id")
      .single();
    expect(error).toBeNull();
    insertedRuleId = data!.id;

    await expectAgreement(fixtures.merchantAId, category!.id);
  });

  it("Case D — priority: a merchant-specific rule outranks a category-specific rule, in both the RPC and commission-calc", async () => {
    const fixtures = inject("qaFixtures");
    const { data: category, error: categoryError } = await db.from("categories").select("id").limit(1).single();
    expect(categoryError).toBeNull();

    // Category rule alone would resolve to 8; the merchant-specific rule
    // added on top must win in both the RPC and the Edge Function.
    const categoryRule = await db
      .from("commission_rules")
      .insert({ scope_type: "category", scope_id: category!.id, rate_percent: 8, is_active: true })
      .select("id")
      .single();
    expect(categoryRule.error).toBeNull();

    const merchantRule = await db
      .from("commission_rules")
      .insert({ scope_type: "merchant", scope_id: fixtures.merchantAId, rate_percent: 3, is_active: true })
      .select("id")
      .single();
    expect(merchantRule.error).toBeNull();

    try {
      const { data: rpcRate } = await db.rpc("get_commission_rate", {
        p_merchant_id: fixtures.merchantAId,
        p_category_id: category!.id,
      });
      expect(Number(rpcRate)).toBe(3);
      await expectAgreement(fixtures.merchantAId, category!.id);
    } finally {
      await db.from("commission_rules").delete().in("id", [categoryRule.data!.id, merchantRule.data!.id]);
    }
  });
});
