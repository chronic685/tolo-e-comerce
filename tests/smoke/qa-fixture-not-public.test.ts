import { beforeAll, describe, expect, inject, it } from "vitest";
import { anonClient, serviceClient } from "../env.ts";

// Regression test for the "QA TEST Store -- DO NOT USE" leak: it was
// publicly visible/listable on the real customer Shops and Marketplace
// pages, because tests/fixtures/ensureQaFixtures.ts deliberately sets
// status: 'active'/'published' on the shared QA fixture (so it behaves
// like a real approved merchant for authorization tests) and nothing in
// the public queries distinguished fixture data from a real listing.
// Migration 0079 added merchants.is_test for exactly this -- this test
// replicates each customer-facing query (anon client, no auth, exactly
// like the real apps) and asserts the fixture never comes back from any
// of them, independent of frontend.
describe("QA fixture merchant/store/product are never publicly visible", () => {
  const anon = anonClient();
  const db = serviceClient();
  let merchantAId: string;
  let storeId: string;
  let storeSlug: string;
  let productId: string;
  let productSlug: string;

  beforeAll(async () => {
    const fixtures = inject("qaFixtures");
    merchantAId = fixtures.merchantAId;

    const { data: merchant, error: merchantError } = await db.from("merchants").select("is_test").eq("id", merchantAId).single();
    if (merchantError) throw merchantError;
    // If this ever fails, migration 0079's backfill didn't reach this
    // project -- everything below would pass for the wrong reason (RLS
    // already hides inactive data; the fixture is deliberately active).
    expect(merchant.is_test).toBe(true);

    const { data: store, error: storeError } = await db.from("stores").select("id, slug").eq("merchant_id", merchantAId).single();
    if (storeError) throw storeError;
    storeId = store.id;
    storeSlug = store.slug;

    const { data: product, error: productError } = await db
      .from("products")
      .select("id, slug")
      .eq("merchant_id", merchantAId)
      .eq("sku", "QA-TEST-001")
      .single();
    if (productError) throw productError;
    productId = product.id;
    productSlug = product.slug;
  });

  it("BrowseShops.tsx's query never returns it", async () => {
    // `!inner` is required: without it, PostgREST leaves merchants as a
    // left join and a row that fails the filter comes back with
    // merchants: null instead of being excluded (the actual bug that let
    // the fixture stay listed even with a status/is_test filter present).
    const { data } = await anon
      .from("stores")
      .select("id, merchants!inner ( status, is_test )")
      .eq("status", "active")
      .in("merchants.status", ["active", "approved"])
      .eq("merchants.is_test", false);
    expect((data ?? []).some((s) => s.id === storeId)).toBe(false);
  });

  it("Marketplace.tsx's product search never returns it", async () => {
    const { data } = await anon
      .from("products")
      .select("id, merchants!inner ( is_test )")
      .eq("status", "published")
      .eq("merchants.is_test", false)
      .ilike("name", "%QA TEST%");
    expect((data ?? []).some((p) => p.id === productId)).toBe(false);
  });

  it("Marketplace.tsx's shop-name search match never returns it", async () => {
    const { data } = await anon
      .from("stores")
      .select("id, status, merchants ( status, is_test )")
      .ilike("name", "%QA TEST%");
    function isStoreOpen(s: { status: string; merchants: { status: string; is_test: boolean } | null }): boolean {
      return s.status === "active" && (s.merchants?.status === "active" || s.merchants?.status === "approved") && s.merchants?.is_test !== true;
    }
    expect(((data ?? []) as { id: string; status: string; merchants: { status: string; is_test: boolean } | null }[]).filter(isStoreOpen).some((s) => s.id === storeId)).toBe(false);
  });

  it("Storefront.tsx treats a direct link to its slug as not found", async () => {
    const { data } = await anon
      .from("stores")
      .select("id, merchants!inner ( is_test )")
      .eq("slug", storeSlug)
      .eq("merchants.is_test", false)
      .maybeSingle();
    expect(data).toBeNull();
  });

  it("ProductDetail.tsx/QuickView.tsx treat a direct link to its slug as not found", async () => {
    const { data } = await anon
      .from("products")
      .select("id, merchants!inner ( is_test )")
      .eq("slug", productSlug)
      .eq("status", "published")
      .eq("merchants.is_test", false)
      .maybeSingle();
    expect(data).toBeNull();
  });
});
