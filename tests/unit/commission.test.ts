import { afterEach, describe, expect, inject, it } from "vitest";
import { serviceClient } from "../env.ts";

// get_commission_rate() is the single authoritative commission-rate
// resolver — called from inside create_order() at checkout, and (since
// Phase 3B) also by commission-calc's pre-checkout estimate via RPC, so
// there is exactly one implementation to test. These tests exercise the
// function that actually determines money movement.
//
// These are integration tests against the real Postgres function, not
// hand-reimplemented pure-JS logic — the calculation is genuinely
// implemented in PL/pgSQL (rate resolution, effective-dating), and
// duplicating it in JS just to unit-test it in isolation would create a
// second source of truth that could silently drift from the real one.
describe("commission calculation: get_commission_rate()", () => {
  const db = serviceClient();
  let insertedRuleId: string | null = null;

  afterEach(async () => {
    if (insertedRuleId) {
      await db.from("commission_rules").delete().eq("id", insertedRuleId);
      insertedRuleId = null;
    }
  });

  it("falls back to the platform/default rate when no merchant or category rule applies", async () => {
    const fixtures = inject("qaFixtures");

    const { data: platformRule } = await db
      .from("commission_rules")
      .select("rate_percent")
      .eq("scope_type", "platform")
      .eq("is_active", true)
      .maybeSingle();
    const { data: setting } = await db
      .from("system_settings")
      .select("value")
      .eq("key", "default_commission_rate_percent")
      .maybeSingle();
    const expected = platformRule ? Number(platformRule.rate_percent) : Number(setting?.value ?? 10);

    const { data, error } = await db.rpc("get_commission_rate", {
      p_merchant_id: fixtures.merchantAId,
      p_category_id: null,
    });
    expect(error).toBeNull();
    expect(Number(data)).toBe(expected);
  });

  it("prefers a merchant-specific active rule over the platform default", async () => {
    const fixtures = inject("qaFixtures");
    const override = 7.5;

    const { data: inserted, error: insertError } = await db
      .from("commission_rules")
      .insert({ scope_type: "merchant", scope_id: fixtures.merchantAId, rate_percent: override, is_active: true })
      .select("id")
      .single();
    expect(insertError).toBeNull();
    insertedRuleId = inserted!.id;

    const { data, error } = await db.rpc("get_commission_rate", {
      p_merchant_id: fixtures.merchantAId,
      p_category_id: null,
    });
    expect(error).toBeNull();
    expect(Number(data)).toBe(override);
  });

  it("ignores an inactive merchant-specific rule", async () => {
    const fixtures = inject("qaFixtures");

    const { data: inserted, error: insertError } = await db
      .from("commission_rules")
      .insert({ scope_type: "merchant", scope_id: fixtures.merchantAId, rate_percent: 99, is_active: false })
      .select("id")
      .single();
    expect(insertError).toBeNull();
    insertedRuleId = inserted!.id;

    const { data } = await db.rpc("get_commission_rate", {
      p_merchant_id: fixtures.merchantAId,
      p_category_id: null,
    });
    expect(Number(data)).not.toBe(99);
  });
});
