import { beforeAll, describe, expect, inject, it } from "vitest";
import { env, serviceClient, signIn } from "../env.ts";
import { callFunction } from "../helpers.ts";

// End-to-end wiring tests for migration 0032's rate limiting, on top of the
// pure-primitive tests in tests/unit/rate-limiting.test.ts. These use
// dedicated identities/keys to avoid interfering with the checkout/review
// calls other test files make against the shared QA customer account.
const db = serviceClient();

describe("rate limiting: checkout", () => {
  // Deliberately NOT qaCustomerEmail — other test files already call
  // checkout with that identity, and would collide with a test that
  // exhausts a shared rate-limit window. Merchant A's account has no cart,
  // so a rate-limited or "cart empty" response is all it will ever get —
  // never a real order.
  let merchantAToken: string;

  beforeAll(async () => {
    merchantAToken = await signIn(env.qaMerchantAEmail, env.qaMerchantAPassword);
    const fixtures = inject("qaFixtures");
    const { data: config } = await db.rpc("get_rate_limit_config", { p_action: "checkout" }).single();
    // Pre-exhaust the quota directly (fast, no HTTP round-trips) using the
    // exact key checkout/index.ts derives from this same user's session.
    for (let i = 0; i < config!.max_count; i++) {
      await db
        .rpc("check_and_record_rate_limit", {
          p_key: `customer:${fixtures.merchantAUserId}:checkout`,
          p_max_count: config!.max_count,
          p_window_seconds: config!.window_seconds,
        })
        .single();
    }
  });

  it("returns 429 once the checkout quota is exhausted, before any order is created", async () => {
    const fixtures = inject("qaFixtures");
    const res = await callFunction("checkout", {
      token: merchantAToken,
      body: { address_id: fixtures.addressId, payment_provider: "cash_on_delivery" },
    });
    expect(res.status).toBe(429);
    expect((res.json as { error?: string })?.error).toBe("too_many_requests");
    expect(res.headers.get("retry-after")).toBeTruthy();
  });

  it("never lets an unauthenticated request reach the rate limiter (always 401, never 429)", async () => {
    for (let i = 0; i < 3; i++) {
      const res = await callFunction("checkout", { body: { address_id: "x", payment_provider: "cash_on_delivery" } });
      expect(res.status).toBe(401);
    }
  });
});

describe("rate limiting: reviews", () => {
  let customerToken: string;

  beforeAll(async () => {
    customerToken = await signIn(env.qaCustomerEmail, env.qaCustomerPassword);
  });

  async function attemptReviewInsert(token: string, customerId: string, merchantOrderId: string, productId: string) {
    const res = await fetch(`${env.supabaseUrl}/rest/v1/reviews`, {
      method: "POST",
      headers: {
        apikey: env.anonKey,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ customer_id: customerId, merchant_order_id: merchantOrderId, product_id: productId, rating: 5 }),
    });
    let json: { code?: string; message?: string } | null = null;
    try {
      json = await res.json();
    } catch {
      // return=minimal gives an empty body on the success case.
    }
    return { status: res.status, code: json?.code };
  }

  it("rejects a review for a not-yet-completed order via the existing completion-check RLS policy, not the rate limiter", async () => {
    const fixtures = inject("qaFixtures");
    // The QA fixture order is permanently left in "new" status (see
    // tests/README.md). A BEFORE INSERT trigger's writes to another table
    // (rate_limit_counters) roll back along with the statement when RLS
    // ultimately rejects the row — so this specific case can never
    // consume real quota no matter how many times it's attempted, which is
    // why it's tested here as its own case rather than folded into the
    // burst test below (see migration 0032's comments for the same note).
    const result = await attemptReviewInsert(customerToken, fixtures.customerUserId, fixtures.merchantOrderId, fixtures.reviewableProductAId);
    expect(result.status).not.toBe(429);
    expect(result.code).not.toBe("PT429");
  });

  it("allows a genuinely eligible review, then rejects the next one once the quota is exhausted", async () => {
    const fixtures = inject("qaFixtures");
    const key = `customer:${fixtures.customerUserId}:review`;

    // Temporarily tighten the policy to 1/hour so this test only needs two
    // real review-eligible products (not the production default of 10) —
    // restored in the finally block below regardless of outcome.
    const { data: originalSettings } = await db.from("system_settings").select("value").eq("key", "rate_limits").single();
    const tightened = { ...originalSettings!.value, review: { max_count: 1, window_seconds: 3600 } };

    try {
      await db.from("system_settings").update({ value: tightened }).eq("key", "rate_limits");
      // Start this key from zero regardless of what earlier test runs left
      // behind within the same real-world hour (service-role test hygiene,
      // not a customer resetting their own limit — RLS still prevents that).
      await db.from("rate_limit_counters").delete().eq("key", key);

      const first = await attemptReviewInsert(customerToken, fixtures.customerUserId, fixtures.reviewableMerchantOrderId, fixtures.reviewableProductAId);
      expect(first.status).toBeLessThan(300);

      const second = await attemptReviewInsert(customerToken, fixtures.customerUserId, fixtures.reviewableMerchantOrderId, fixtures.reviewableProductBId);
      expect(second.status).toBe(429);
      expect(second.code).toBe("PT429");
    } finally {
      await db.from("system_settings").update({ value: originalSettings!.value }).eq("key", "rate_limits");
      await db.from("rate_limit_counters").delete().eq("key", key);
      // The first insert really did commit — remove it so this test (and
      // the reviewable-order fixture) stay repeatable on the next run.
      await db.from("reviews").delete().eq("merchant_order_id", fixtures.reviewableMerchantOrderId).eq("product_id", fixtures.reviewableProductAId);
    }
  });
});
