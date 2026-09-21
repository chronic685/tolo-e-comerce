import { afterEach, beforeAll, describe, expect, inject, it } from "vitest";
import { env, serviceClient, signIn } from "../env.ts";

// Phase 11: merchants_avg_rating/merchants_review_count (migration 0045),
// the computed-column functions rolling per-product reviews up to a
// merchant score. Reviews reference products directly (no variant
// involved), so these fixtures need no inventory/variant boilerplate at all.
const db = serviceClient();

async function fetchRating(merchantId: string): Promise<{ avgRating: number | null; reviewCount: number }> {
  const { data, error } = await db
    .from("merchants")
    .select("avg_rating:merchants_avg_rating, review_count:merchants_review_count")
    .eq("id", merchantId)
    .single();
  if (error) throw error;
  return { avgRating: data.avg_rating == null ? null : Number(data.avg_rating), reviewCount: Number(data.review_count) };
}

// Reviews must be inserted through the real customer JWT, not the service
// client: enforce_review_rate_limit() (migration 0032) derives its counter
// key from auth.uid(), which is null under the service role, so a
// service-client insert always fails the rate_limit_counters not-null
// constraint before RLS is even reached. This mirrors
// tests/smoke/rate-limiting.test.ts's attemptReviewInsert exactly.
async function insertReview(token: string, customerId: string, merchantOrderId: string, productId: string, rating: number) {
  const res = await fetch(`${env.supabaseUrl}/rest/v1/reviews`, {
    method: "POST",
    headers: {
      apikey: env.anonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({ customer_id: customerId, merchant_order_id: merchantOrderId, product_id: productId, rating }),
  });
  const json = await res.json();
  return { status: res.status, row: Array.isArray(json) ? json[0] : json };
}

describe("merchants_avg_rating / merchants_review_count", () => {
  let merchantAId: string;
  let storeId: string;
  let customerUserId: string;
  let reviewableMerchantOrderId: string;
  let customerToken: string;
  const createdProductIds: string[] = [];
  const createdReviewIds: string[] = [];

  beforeAll(async () => {
    const fixtures = inject("qaFixtures");
    merchantAId = fixtures.merchantAId;
    customerUserId = fixtures.customerUserId;
    reviewableMerchantOrderId = fixtures.reviewableMerchantOrderId;
    customerToken = await signIn(env.qaCustomerEmail, env.qaCustomerPassword);
    const { data: store } = await db.from("stores").select("id").eq("merchant_id", merchantAId).single();
    storeId = store!.id;
  });

  afterEach(async () => {
    for (const id of createdReviewIds.splice(0)) {
      await db.from("reviews").delete().eq("id", id);
    }
    for (const id of createdProductIds.splice(0)) {
      await db.from("products").delete().eq("id", id);
    }
  });

  it("returns null/0 for a merchant with no reviews at all", async () => {
    // A throwaway merchant with zero products (and therefore zero reviews)
    // proves the zero-reviews case cleanly, independent of whatever
    // fixture/leftover review data already exists for the QA merchants.
    const { data: throwawayMerchant, error } = await db
      .from("merchants")
      .insert({
        owner_id: customerUserId,
        business_name: "QA TEST — Phase 11 unrated merchant",
        business_category: "Other",
        location: "QA Fixture",
        status: "active",
      })
      .select("id")
      .single();
    expect(error).toBeNull();

    const rating = await fetchRating(throwawayMerchant!.id);
    expect(rating.avgRating).toBeNull();
    expect(rating.reviewCount).toBe(0);

    await db.from("merchants").delete().eq("id", throwawayMerchant!.id);
  });

  it("averages reviews across all of a merchant's products, regardless of each product's current status", async () => {
    const before = await fetchRating(merchantAId);

    // One published, one archived -- proves the aggregate isn't silently
    // scoped to only currently-published products (see migration 0045's
    // reasoning: products_public_select_published RLS would otherwise hide
    // the archived one's reviews from an anonymous caller).
    const { data: publishedProduct, error: publishedError } = await db
      .from("products")
      .insert({
        merchant_id: merchantAId,
        store_id: storeId,
        name: "QA TEST — Phase 11 rating product (published)",
        slug: `qa-test-rating-published-${Date.now()}`,
        base_price: 100,
        status: "published",
      })
      .select("id")
      .single();
    expect(publishedError).toBeNull();
    createdProductIds.push(publishedProduct!.id);

    const { data: archivedProduct, error: archivedError } = await db
      .from("products")
      .insert({
        merchant_id: merchantAId,
        store_id: storeId,
        name: "QA TEST — Phase 11 rating product (archived)",
        slug: `qa-test-rating-archived-${Date.now()}`,
        base_price: 100,
        status: "archived",
      })
      .select("id")
      .single();
    expect(archivedError).toBeNull();
    createdProductIds.push(archivedProduct!.id);

    // reviews_insert_own (migration 0031) only checks that the merchant
    // order belongs to this customer and is completed -- it never checks
    // that product_id was actually part of that order -- so any product_id
    // can be attached to the shared reviewableMerchantOrderId fixture here.
    const review1 = await insertReview(customerToken, customerUserId, reviewableMerchantOrderId, publishedProduct!.id, 4);
    expect(review1.status).toBeLessThan(300);
    createdReviewIds.push(review1.row.id);

    const review2 = await insertReview(customerToken, customerUserId, reviewableMerchantOrderId, archivedProduct!.id, 2);
    expect(review2.status).toBeLessThan(300);
    createdReviewIds.push(review2.row.id);

    const after = await fetchRating(merchantAId);
    expect(after.reviewCount).toBe(before.reviewCount + 2);

    // Weighted delta check rather than asserting an absolute average, since
    // other reviews may already exist on this shared fixture merchant.
    const beforeTotal = (before.avgRating ?? 0) * before.reviewCount;
    const afterTotal = (after.avgRating ?? 0) * after.reviewCount;
    expect(Math.round((afterTotal - beforeTotal) * 10) / 10).toBe(6); // 4 + 2
  });

  it("is readable by an anonymous (unauthenticated) caller, needed for public storefront browsing", async () => {
    const res = await fetch(
      `${env.supabaseUrl}/rest/v1/merchants?id=eq.${merchantAId}&select=avg_rating:merchants_avg_rating,review_count:merchants_review_count`,
      { headers: { apikey: env.anonKey } },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json)).toBe(true);
    expect(json[0]).toHaveProperty("avg_rating");
    expect(json[0]).toHaveProperty("review_count");
  });
});
