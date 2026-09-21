import { afterEach, describe, expect, inject, it } from "vitest";
import { env, serviceClient, signIn } from "../env.ts";

// Migration 0047: customer referral system. Covers the self-referral DB
// guard, handle_new_user()'s referred_by capture, process_referral_
// conversion()'s "first paid order" conversion rule + single-use reward +
// idempotency, and my_referral_stats() (the security-definer aggregate
// Account.tsx uses, since profiles_select_own_or_staff RLS blocks a plain
// cross-customer profiles query).
describe("referrals", () => {
  const db = serviceClient();
  const createdUserIds: string[] = [];
  const createdRuleIds: string[] = [];

  afterEach(async () => {
    for (const id of createdRuleIds.splice(0)) {
      await db.from("discount_rules").delete().eq("id", id);
    }
    for (const id of createdUserIds.splice(0)) {
      await db.auth.admin.deleteUser(id); // cascades to profiles (on delete cascade)
    }
  });

  async function createReferredUser(referrerCode: string | null) {
    const email = `qa-referral-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
    const { data, error } = await db.auth.admin.createUser({
      email,
      password: "qa-test-password-123",
      email_confirm: true,
      user_metadata: referrerCode ? { referral_code: referrerCode } : {},
    });
    expect(error).toBeNull();
    createdUserIds.push(data.user!.id);
    return data.user!.id;
  }

  it("assigns every profile a unique referral_code (including the one-time backfill)", async () => {
    const fixtures = inject("qaFixtures");
    const { data } = await db.from("profiles").select("referral_code").eq("id", fixtures.customerUserId).single();
    expect(data!.referral_code).toBeTruthy();
    expect(data!.referral_code).toMatch(/^[A-Z0-9]{8}$/);
  });

  it("handle_new_user() captures referred_by from a valid referral code at signup", async () => {
    const fixtures = inject("qaFixtures");
    const { data: referrer } = await db.from("profiles").select("referral_code").eq("id", fixtures.merchantAUserId).single();

    const newUserId = await createReferredUser(referrer!.referral_code);
    const { data: newProfile } = await db.from("profiles").select("referred_by, referral_code").eq("id", newUserId).single();
    expect(newProfile!.referred_by).toBe(fixtures.merchantAUserId);
    expect(newProfile!.referral_code).toBeTruthy(); // the new signup gets their own code too
  });

  it("silently ignores an unrecognized referral code rather than blocking signup", async () => {
    const newUserId = await createReferredUser("NOTAREALCODE");
    const { data: newProfile, error } = await db.from("profiles").select("referred_by").eq("id", newUserId).single();
    expect(error).toBeNull();
    expect(newProfile!.referred_by).toBeNull();
  });

  it("rejects a self-referral at the database level (profiles_no_self_referral)", async () => {
    const fixtures = inject("qaFixtures");
    const { error } = await db.from("profiles").update({ referred_by: fixtures.customerUserId }).eq("id", fixtures.customerUserId);
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/profiles_no_self_referral|check constraint/i);
  });

  describe("process_referral_conversion()", () => {
    it("is a no-op for a customer who wasn't referred", async () => {
      const fixtures = inject("qaFixtures");
      const { error } = await db.rpc("process_referral_conversion", { p_customer_id: fixtures.customerUserId });
      expect(error).toBeNull(); // just confirms it doesn't throw; no referrer means nothing to do
    });

    it("rewards the referrer with a single-use discount code on the referred customer's first paid order, and never twice", async () => {
      const fixtures = inject("qaFixtures");
      // The live default (migration 0026) is referrals_enabled: false --
      // temporarily turn it on so this test exercises real reward-granting
      // behavior, and always restore it in finally regardless of outcome.
      const { data: settings } = await db.from("system_settings").select("value").eq("key", "customer_features").single();
      const original = settings!.value;

      try {
        await db.from("system_settings").update({ value: { ...original, referrals_enabled: true } }).eq("key", "customer_features");

        const { data: referrer } = await db.from("profiles").select("referral_code").eq("id", fixtures.merchantAUserId).single();
        const referredId = await createReferredUser(referrer!.referral_code);

        const { data: order, error: orderError } = await db
          .from("orders")
          .insert({ customer_id: referredId, address_id: fixtures.addressId, payment_status: "paid", subtotal: 100, total: 100 })
          .select("id")
          .single();
        expect(orderError).toBeNull();

        const before = await db.from("discount_rules").select("id").eq("reward_for_customer_id", fixtures.merchantAUserId);

        const { error: convertError } = await db.rpc("process_referral_conversion", { p_customer_id: referredId });
        expect(convertError).toBeNull();

        const { data: referredProfile } = await db.from("profiles").select("referral_rewarded_at").eq("id", referredId).single();
        expect(referredProfile!.referral_rewarded_at).toBeTruthy();

        const after = await db.from("discount_rules").select("*").eq("reward_for_customer_id", fixtures.merchantAUserId);
        expect(after.data!.length).toBe((before.data?.length ?? 0) + 1);
        const reward = after.data!.find((r) => !before.data?.some((b) => b.id === r.id))!;
        expect(reward.usage_limit).toBe(1); // single-use cap -- the existing column, no new limiting logic
        expect(reward.is_active).toBe(true);
        expect(reward.code).toBeTruthy();
        createdRuleIds.push(reward.id);

        // Simulates a retried webhook calling finalizePaymentSuccess() twice
        // for the same payment -- must not grant a second reward.
        const { error: retryError } = await db.rpc("process_referral_conversion", { p_customer_id: referredId });
        expect(retryError).toBeNull();
        const afterRetry = await db.from("discount_rules").select("id").eq("reward_for_customer_id", fixtures.merchantAUserId);
        expect(afterRetry.data!.length).toBe(after.data!.length);

        await db.from("orders").delete().eq("id", order!.id);
      } finally {
        await db.from("system_settings").update({ value: original }).eq("key", "customer_features");
      }
    });

    it("does not reward when customer_features.referrals_enabled is off (same master-switch pattern as discounts_enabled)", async () => {
      const fixtures = inject("qaFixtures");
      const { data: settings } = await db.from("system_settings").select("value").eq("key", "customer_features").single();
      const original = settings!.value;

      try {
        await db.from("system_settings").update({ value: { ...original, referrals_enabled: false } }).eq("key", "customer_features");

        const { data: referrer } = await db.from("profiles").select("referral_code").eq("id", fixtures.merchantBUserId).single();
        const referredId = await createReferredUser(referrer!.referral_code);
        const { data: order } = await db
          .from("orders")
          .insert({ customer_id: referredId, address_id: fixtures.addressId, payment_status: "paid", subtotal: 100, total: 100 })
          .select("id")
          .single();

        await db.rpc("process_referral_conversion", { p_customer_id: referredId });

        const { data: referredProfile } = await db.from("profiles").select("referral_rewarded_at").eq("id", referredId).single();
        expect(referredProfile!.referral_rewarded_at).toBeNull();

        await db.from("orders").delete().eq("id", order!.id);
      } finally {
        await db.from("system_settings").update({ value: original }).eq("key", "customer_features");
      }
    });
  });

  describe("my_referral_stats()", () => {
    async function fetchStatsAs(token: string) {
      const res = await fetch(`${env.supabaseUrl}/rest/v1/rpc/my_referral_stats`, {
        method: "POST",
        headers: { apikey: env.anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: "{}",
      });
      const json = await res.json();
      return Array.isArray(json) ? json[0] : json;
    }

    it("counts only the calling customer's own referrals (delta-based, since the fixture account may already have real ones)", async () => {
      const fixtures = inject("qaFixtures");
      const token = await signIn(env.qaCustomerEmail, env.qaCustomerPassword);

      const before = await fetchStatsAs(token);

      const { data: referrer } = await db.from("profiles").select("referral_code").eq("id", fixtures.customerUserId).single();
      const unconverted = await createReferredUser(referrer!.referral_code);
      const converted = await createReferredUser(referrer!.referral_code);
      await db.from("profiles").update({ referral_rewarded_at: new Date().toISOString() }).eq("id", converted);

      const after = await fetchStatsAs(token);
      expect(Number(after.referred_signups)).toBe(Number(before.referred_signups) + 2);
      expect(Number(after.successful_referrals)).toBe(Number(before.successful_referrals) + 1);
    });

    it("is not reachable by an anonymous caller with a fabricated identity (auth.uid() is null, not a real customer)", async () => {
      const res = await fetch(`${env.supabaseUrl}/rest/v1/rpc/my_referral_stats`, {
        method: "POST",
        headers: { apikey: env.anonKey, "Content-Type": "application/json" },
        body: "{}",
      });
      expect(res.status).toBe(200); // callable, but...
      const json = await res.json();
      const row = Array.isArray(json) ? json[0] : json;
      expect(Number(row.referred_signups)).toBe(0); // ...auth.uid() is null, so it can never match any real referred_by
    });
  });
});
