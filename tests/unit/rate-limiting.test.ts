import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { serviceClient } from "../env.ts";

// Integration tests against the real check_and_record_rate_limit()/
// get_rate_limit_config() Postgres functions (migration 0032) — using
// synthetic, per-test keys so these never interact with the checkout/review
// rate limits real QA accounts share with other test files (see
// tests/smoke/rate-limiting.test.ts for the end-to-end wiring tests, and
// tests/README.md for why this project doesn't have an isolated test DB).
describe("rate limiting: check_and_record_rate_limit()", () => {
  const db = serviceClient();

  it("allows exactly max_count requests within the window, then rejects", async () => {
    const key = `test:${randomUUID()}`;
    const results: boolean[] = [];
    for (let i = 0; i < 7; i++) {
      const { data, error } = await db.rpc("check_and_record_rate_limit", { p_key: key, p_max_count: 5, p_window_seconds: 60 }).single();
      expect(error).toBeNull();
      results.push(data!.allowed);
    }
    expect(results).toEqual([true, true, true, true, true, false, false]);
  });

  it("is atomic under concurrent requests — a burst never allows more than max_count", async () => {
    const key = `test:${randomUUID()}`;
    const attempts = 20;
    const maxCount = 5;

    const responses = await Promise.all(
      Array.from({ length: attempts }, () =>
        db.rpc("check_and_record_rate_limit", { p_key: key, p_max_count: maxCount, p_window_seconds: 60 }).single(),
      ),
    );

    const allowedCount = responses.filter((r) => r.data?.allowed).length;
    expect(allowedCount).toBe(maxCount);
    expect(responses.every((r) => r.error === null)).toBe(true);
  });

  it("keeps independent keys fully isolated — one identity's usage never affects another's", async () => {
    const keyA = `test:${randomUUID()}`;
    const keyB = `test:${randomUUID()}`;

    for (let i = 0; i < 5; i++) {
      await db.rpc("check_and_record_rate_limit", { p_key: keyA, p_max_count: 5, p_window_seconds: 60 }).single();
    }
    // Key A is now exhausted; key B must be completely unaffected.
    const { data: aResult } = await db.rpc("check_and_record_rate_limit", { p_key: keyA, p_max_count: 5, p_window_seconds: 60 }).single();
    const { data: bResult } = await db.rpc("check_and_record_rate_limit", { p_key: keyB, p_max_count: 5, p_window_seconds: 60 }).single();

    expect(aResult!.allowed).toBe(false);
    expect(bResult!.allowed).toBe(true);
  });

  it("recovers once a new window starts, without waiting for the real-world window duration", async () => {
    const key = `test:${randomUUID()}`;
    // A short window lets this test prove real recovery behavior
    // deterministically and quickly, instead of mocking the clock or
    // sleeping for a production-length window. 3s (not 1s) gives enough
    // margin for the exhaustion phase's sequential network round-trips to
    // reliably land inside a single window before it rolls over.
    const windowSeconds = 3;
    for (let i = 0; i < 3; i++) {
      await db.rpc("check_and_record_rate_limit", { p_key: key, p_max_count: 3, p_window_seconds: windowSeconds }).single();
    }
    const { data: exhausted } = await db.rpc("check_and_record_rate_limit", { p_key: key, p_max_count: 3, p_window_seconds: windowSeconds }).single();
    expect(exhausted!.allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, windowSeconds * 1000 + 500));

    const { data: recovered } = await db.rpc("check_and_record_rate_limit", { p_key: key, p_max_count: 3, p_window_seconds: windowSeconds }).single();
    expect(recovered!.allowed).toBe(true);
  });

  it("reports a reliable retry_after_seconds that never exceeds the configured window", async () => {
    const key = `test:${randomUUID()}`;
    const { data } = await db.rpc("check_and_record_rate_limit", { p_key: key, p_max_count: 1, p_window_seconds: 30 }).single();
    expect(data!.retry_after_seconds).toBeGreaterThanOrEqual(0);
    expect(data!.retry_after_seconds).toBeLessThanOrEqual(30);
  });

  it("self-cleans expired windows for a key instead of growing without bound", async () => {
    const key = `test:${randomUUID()}`;
    await db.rpc("check_and_record_rate_limit", { p_key: key, p_max_count: 5, p_window_seconds: 2 }).single();
    await new Promise((resolve) => setTimeout(resolve, 2500));
    // This call's internal cleanup step deletes the now-expired window row
    // for this key before inserting the new one.
    await db.rpc("check_and_record_rate_limit", { p_key: key, p_max_count: 5, p_window_seconds: 2 }).single();

    const { count } = await db.from("rate_limit_counters").select("*", { count: "exact", head: true }).eq("key", key);
    expect(count).toBe(1);
  });
});

describe("rate limiting: get_rate_limit_config()", () => {
  const db = serviceClient();

  it("returns the seeded checkout and review policy values", async () => {
    const { data: checkout, error: checkoutError } = await db.rpc("get_rate_limit_config", { p_action: "checkout" }).single();
    const { data: review, error: reviewError } = await db.rpc("get_rate_limit_config", { p_action: "review" }).single();
    expect(checkoutError).toBeNull();
    expect(reviewError).toBeNull();
    expect(checkout!.max_count).toBeGreaterThan(0);
    expect(checkout!.window_seconds).toBeGreaterThan(0);
    expect(review!.max_count).toBeGreaterThan(0);
    expect(review!.window_seconds).toBeGreaterThan(0);
  });

  it("falls back to safe defaults for an unrecognized action instead of erroring", async () => {
    const { data, error } = await db.rpc("get_rate_limit_config", { p_action: "not_a_real_action" }).single();
    expect(error).toBeNull();
    expect(data!.max_count).toBeGreaterThan(0);
    expect(data!.window_seconds).toBeGreaterThan(0);
  });
});
