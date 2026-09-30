import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeAll, describe, expect, inject, it } from "vitest";
import { env, serviceClient, signIn } from "../env.ts";

// Group 3, item 10 (migration 0062). discount_rules_manage RLS already
// existed (admin-only); this widened it to also allow a merchant to
// manage their own funded_by='merchant' rules scoped to their own shop or
// product. resolve_best_discount()/create_order() already apply any
// is_active rule regardless of who created it (migration 0046) -- not
// re-tested here, only the new authorization boundary this migration adds.
const db = serviceClient();

function authedClient(token: string) {
  return createClient(env.supabaseUrl, env.anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

describe("merchant promotions (discount_rules_manage RLS, migration 0062)", () => {
  let merchantAToken: string;
  let merchantBToken: string;
  let merchantAId: string;
  let merchantBId: string;
  let productId: string;
  const createdRuleIds: string[] = [];

  beforeAll(async () => {
    merchantAToken = await signIn(env.qaMerchantAEmail, env.qaMerchantAPassword);
    merchantBToken = await signIn(env.qaMerchantBEmail, env.qaMerchantBPassword);
    const fixtures = inject("qaFixtures");
    merchantAId = fixtures.merchantAId;
    merchantBId = fixtures.merchantBId;

    const { data: variant } = await db.from("product_variants").select("product_id").eq("id", fixtures.variantId).single();
    productId = variant!.product_id;
  });

  afterEach(async () => {
    for (const id of createdRuleIds.splice(0)) {
      await db.from("discount_rules").delete().eq("id", id);
    }
  });

  it("lets a merchant create a self-funded promotion scoped to their own shop", async () => {
    const client = authedClient(merchantAToken);
    const { data, error } = await client
      .from("discount_rules")
      .insert({
        name: "QA test: shop promo",
        scope_type: "merchant",
        scope_id: merchantAId,
        discount_kind: "percent",
        amount: 10,
        funded_by: "merchant",
        is_active: true,
      })
      .select()
      .single();
    expect(error).toBeNull();
    createdRuleIds.push(data!.id);
  });

  it("lets a merchant create a self-funded promotion scoped to their own product", async () => {
    const client = authedClient(merchantAToken);
    const { data, error } = await client
      .from("discount_rules")
      .insert({
        name: "QA test: product promo",
        scope_type: "product",
        scope_id: productId,
        discount_kind: "fixed",
        amount: 5,
        funded_by: "merchant",
        is_active: true,
      })
      .select()
      .single();
    expect(error).toBeNull();
    createdRuleIds.push(data!.id);
  });

  it("refuses a promotion scoped to a different merchant's shop", async () => {
    const client = authedClient(merchantAToken);
    const { error } = await client.from("discount_rules").insert({
      name: "QA test: cross-merchant attempt",
      scope_type: "merchant",
      scope_id: merchantBId,
      discount_kind: "percent",
      amount: 10,
      funded_by: "merchant",
      is_active: true,
    });
    expect(error).not.toBeNull();
  });

  it("refuses a merchant-created promotion funded by Tolo instead of the merchant", async () => {
    const client = authedClient(merchantAToken);
    const { error } = await client.from("discount_rules").insert({
      name: "QA test: tolo-funded attempt",
      scope_type: "merchant",
      scope_id: merchantAId,
      discount_kind: "percent",
      amount: 10,
      funded_by: "tolo",
      is_active: true,
    });
    expect(error).not.toBeNull();
  });

  it("refuses a platform-scoped promotion from a merchant", async () => {
    const client = authedClient(merchantAToken);
    const { error } = await client.from("discount_rules").insert({
      name: "QA test: platform scope attempt",
      scope_type: "platform",
      discount_kind: "percent",
      amount: 10,
      funded_by: "merchant",
      is_active: true,
    });
    expect(error).not.toBeNull();
  });

  it("does not let one merchant edit another merchant's self-funded promotion", async () => {
    const { data: rule, error: insertError } = await db
      .from("discount_rules")
      .insert({
        name: "QA test: merchant A owns this",
        scope_type: "merchant",
        scope_id: merchantAId,
        discount_kind: "percent",
        amount: 10,
        funded_by: "merchant",
        is_active: true,
      })
      .select()
      .single();
    expect(insertError).toBeNull();
    createdRuleIds.push(rule!.id);

    const clientB = authedClient(merchantBToken);
    const { error, data } = await clientB.from("discount_rules").update({ amount: 50 }).eq("id", rule!.id).select("id");
    // RLS silently matches zero rows rather than erroring -- assert nothing
    // changed. Checking `data` (the actually-returned/updated rows) rather
    // than a `count: "exact"` response header, which some PostgREST/
    // supabase-js versions report as null rather than 0 for a zero-row
    // UPDATE...RETURNING under RLS.
    expect(error).toBeNull();
    expect(data).toHaveLength(0);

    const { data: unchanged } = await db.from("discount_rules").select("amount").eq("id", rule!.id).single();
    expect(Number(unchanged!.amount)).toBe(10);
  });
});
