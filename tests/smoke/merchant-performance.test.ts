import { beforeAll, describe, expect, inject, it } from "vitest";
import { env, serviceClient, signIn } from "../env.ts";

// Group 3, item 12 (migration 0063). merchant_orders belonging to the
// shared QA merchant A fixture accumulate across the whole test suite run
// (no isolated test DB, see tests/README.md), so these don't assert a
// hardcoded expected percentage -- they independently recompute the same
// formula from a raw query and check the computed column agrees with it,
// which holds regardless of what else in the suite has touched merchant A.
const db = serviceClient();

async function createDisposableOrder(customerUserId: string, addressId: string, variantId: string) {
  const { data: orderId, error } = await db.rpc("create_order", {
    p_customer_id: customerUserId,
    p_address_id: addressId,
    p_items: [{ variant_id: variantId, quantity: 1 }],
  });
  if (error) throw error;
  const { data: mo, error: moError } = await db.from("merchant_orders").select("id").eq("order_id", orderId as string).single();
  if (moError) throw moError;
  return mo.id as string;
}

async function performanceFor(merchantId: string) {
  const { data, error } = await db
    .from("merchants")
    .select(
      "acceptance_rate:merchant_acceptance_rate, cancellation_rate:merchant_cancellation_rate, avg_prep_minutes:merchant_avg_prep_minutes",
    )
    .eq("id", merchantId)
    .single();
  if (error) throw error;
  return data as { acceptance_rate: number | null; cancellation_rate: number | null; avg_prep_minutes: number | null };
}

// PostgREST caps every response at max_rows (1000, supabase/config.toml), and
// the shared QA merchant A has accumulated thousands of orders -- a plain
// select silently returns only the first 1000, so the recomputed expectation
// would disagree with the SQL function, which counts every row.
async function fetchAllMerchantOrders<T>(columns: string, merchantId: string, extra?: (q: any) => any): Promise<T[]> {
  const pageSize = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    let query = db.from("merchant_orders").select(columns).eq("merchant_id", merchantId).order("id");
    if (extra) query = extra(query);
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < pageSize) return rows;
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

describe("merchant performance scores (migration 0063)", () => {
  let merchantAId: string;
  let customerUserId: string;
  let addressId: string;
  let variantId: string;

  beforeAll(async () => {
    await signIn(env.qaMerchantAEmail, env.qaMerchantAPassword);
    const fixtures = inject("qaFixtures");
    merchantAId = fixtures.merchantAId;
    customerUserId = fixtures.customerUserId;
    addressId = fixtures.addressId;
    variantId = fixtures.variantId;
  });

  // Disposable orders are left in place (orders/merchant_orders are never
  // deleted elsewhere in this suite either) -- each test recomputes its
  // expectation from a fresh raw query, so leftover rows from earlier
  // tests are already accounted for rather than needing cleanup.
  it("acceptance_rate and cancellation_rate match an independently recomputed formula", async () => {
    // Move the needle with one order of each outcome so this isn't just
    // asserting whatever the pre-existing totals already were.
    const acceptedId = await createDisposableOrder(customerUserId, addressId, variantId);
    await db.from("merchant_orders").update({ status: "accepted", order_received_at: new Date().toISOString() }).eq("id", acceptedId);

    const rejectedId = await createDisposableOrder(customerUserId, addressId, variantId);
    await db.from("merchant_orders").update({ status: "rejected" }).eq("id", rejectedId);

    const cancelledId = await createDisposableOrder(customerUserId, addressId, variantId);
    await db.from("merchant_orders").update({ status: "cancelled" }).eq("id", cancelledId);

    const allOrders = await fetchAllMerchantOrders<{ status: string }>("status", merchantAId);
    const total = allOrders.length;
    const decided = allOrders.filter((o) => o.status !== "new").length;
    const accepted = allOrders.filter((o) => o.status !== "new" && o.status !== "rejected").length;
    const cancelled = allOrders.filter((o) => o.status === "cancelled").length;
    const expectedAcceptanceRate = decided > 0 ? round1((accepted / decided) * 100) : null;
    const expectedCancellationRate = total > 0 ? round1((cancelled / total) * 100) : null;

    const actual = await performanceFor(merchantAId);
    expect(actual.acceptance_rate).toBe(expectedAcceptanceRate);
    expect(actual.cancellation_rate).toBe(expectedCancellationRate);
  });

  it("avg_prep_minutes matches an independently recomputed average of order_received_at -> ready_for_pickup_at", async () => {
    const orderId = await createDisposableOrder(customerUserId, addressId, variantId);
    const receivedAt = new Date(Date.now() - 20 * 60_000);
    const readyAt = new Date();
    await db
      .from("merchant_orders")
      .update({ status: "ready_for_pickup", order_received_at: receivedAt.toISOString(), ready_for_pickup_at: readyAt.toISOString() })
      .eq("id", orderId);

    const timedOrders = await fetchAllMerchantOrders<{ order_received_at: string; ready_for_pickup_at: string }>(
      "order_received_at, ready_for_pickup_at",
      merchantAId,
      (q) => q.not("order_received_at", "is", null).not("ready_for_pickup_at", "is", null),
    );

    const minutes = timedOrders.map(
      (o) => (new Date(o.ready_for_pickup_at!).getTime() - new Date(o.order_received_at!).getTime()) / 60_000,
    );
    const expectedAvg = round1(minutes.reduce((sum, m) => sum + m, 0) / minutes.length);

    const actual = await performanceFor(merchantAId);
    expect(actual.avg_prep_minutes).toBe(expectedAvg);
  });

  it("acceptance_rate is null for a merchant with no decided orders yet", async () => {
    // A merchant with zero merchant_orders at all -- created fresh so this
    // is guaranteed true, unlike reusing a shared fixture merchant.
    //
    // Cleanup lives in `finally`, not after the assertions, on purpose: it
    // used to run after them, so a failed assertion skipped it and left an
    // orphaned "QA perf test merchant" row (and its auth user) behind in
    // the live project every time -- nine of them accumulated this way
    // before it was caught (see migration 0079's commit). is_test: true
    // for the same reason the shared QA fixtures carry it now, in case
    // this one is ever found still live despite the fix below.
    const email = `qa-perftest-${Date.now()}@example.test`;
    const { data: user, error: userError } = await db.auth.admin.createUser({ email, password: "qa-test-password-123", email_confirm: true });
    expect(userError).toBeNull();
    const { data: merchant, error: merchantError } = await db
      .from("merchants")
      .insert({ owner_id: user.user!.id, business_name: "QA perf test merchant", status: "active", is_test: true })
      .select("id")
      .single();
    expect(merchantError).toBeNull();

    try {
      const actual = await performanceFor(merchant!.id);
      expect(actual.acceptance_rate).toBeNull();
      expect(actual.cancellation_rate).toBeNull();
      expect(actual.avg_prep_minutes).toBeNull();
    } finally {
      await db.from("merchants").delete().eq("id", merchant!.id);
      await db.auth.admin.deleteUser(user.user!.id);
    }
  });
});
