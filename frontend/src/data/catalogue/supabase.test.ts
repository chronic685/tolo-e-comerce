import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseCatalogue } from "./supabase";

type Call = [method: string, ...args: unknown[]];

/** A stand-in for the Supabase client: every query-builder call is recorded, and awaiting the query yields `result`. */
function fakeSupabase(result: { data: unknown; count?: number | null } = { data: [], count: 0 }) {
  const queries: { table: string; calls: Call[] }[] = [];
  const client = {
    from(table: string) {
      const q = { table, calls: [] as Call[] };
      queries.push(q);
      const builder: Record<string, unknown> = new Proxy(
        {},
        {
          get(_t, method: string) {
            if (method === "then") return (resolve: (v: unknown) => void) => resolve(result);
            return (...args: unknown[]) => {
              q.calls.push([method, ...args]);
              return builder;
            };
          },
        },
      );
      return builder;
    },
  };
  return { supabase: client as unknown as SupabaseClient, queries };
}

const has = (calls: Call[], ...expected: unknown[]) => calls.some((c) => expected.length === c.length && expected.every((e, i) => JSON.stringify(e) === JSON.stringify(c[i])));

describe("supabase catalogue (the queries the screens ran before, behind the adapter)", () => {
  it("lists only active categories in sort order", async () => {
    const { supabase, queries } = fakeSupabase({ data: [{ id: "c1" }] });
    expect(await createSupabaseCatalogue(supabase).listCategories()).toEqual([{ id: "c1" }]);
    expect(queries[0].table).toBe("categories");
    expect(has(queries[0].calls, "eq", "is_active", true)).toBe(true);
    expect(has(queries[0].calls, "order", "sort_order")).toBe(true);
  });

  it("filters and orders products by the server-computed customer price, never the merchant price", async () => {
    const { supabase, queries } = fakeSupabase({ data: [{ id: "p1" }], count: 40 });
    const page = await createSupabaseCatalogue(supabase).listProducts({ page: 3, pageSize: 12, categoryId: "c1", search: " shoe ", minPrice: 500, maxPrice: 3000, sort: "price_desc" });
    expect(page).toEqual({ items: [{ id: "p1" }], total: 40 });
    const calls = queries[0].calls;
    expect(queries[0].table).toBe("products");
    expect(has(calls, "eq", "status", "published")).toBe(true);
    expect(has(calls, "eq", "merchants.is_test", false)).toBe(true);
    expect(has(calls, "eq", "category_id", "c1")).toBe(true);
    expect(has(calls, "ilike", "name", "%shoe%")).toBe(true);
    expect(has(calls, "gte", "products_customer_price", 500)).toBe(true);
    expect(has(calls, "lte", "products_customer_price", 3000)).toBe(true);
    expect(has(calls, "order", "products_customer_price", { ascending: false })).toBe(true);
    expect(has(calls, "range", 24, 35)).toBe(true);
  });

  it("orders by rating with unrated products last, by newest by default, and by price ascending", async () => {
    const { supabase, queries } = fakeSupabase();
    const catalogue = createSupabaseCatalogue(supabase);
    await catalogue.listProducts({ page: 1, pageSize: 12, sort: "rating_desc" });
    await catalogue.listProducts({ page: 1, pageSize: 12 });
    await catalogue.listProducts({ page: 1, pageSize: 12, sort: "price_asc" });
    expect(has(queries[0].calls, "order", "products_avg_rating", { ascending: false, nullsFirst: false })).toBe(true);
    expect(has(queries[1].calls, "order", "created_at", { ascending: false })).toBe(true);
    expect(has(queries[2].calls, "order", "products_customer_price", { ascending: true })).toBe(true);
  });

  it("selects a shop's products by store, with no merchant embed, and featured products by flag", async () => {
    const { supabase, queries } = fakeSupabase();
    const catalogue = createSupabaseCatalogue(supabase);
    await catalogue.listProducts({ page: 1, pageSize: 12, storeId: "s1" });
    await catalogue.listProducts({ page: 1, pageSize: 10, featured: true });
    expect(has(queries[0].calls, "eq", "store_id", "s1")).toBe(true);
    expect(has(queries[0].calls, "eq", "merchants.is_test", false)).toBe(false);
    expect(has(queries[1].calls, "eq", "is_featured", true)).toBe(true);
    expect(has(queries[1].calls, "range", 0, 9)).toBe(true);
  });

  it("gets a product by slug, published and not a test fixture", async () => {
    const { supabase, queries } = fakeSupabase({ data: { id: "p1" } });
    expect(await createSupabaseCatalogue(supabase).getProduct("leather-shoes")).toEqual({ id: "p1" });
    expect(has(queries[0].calls, "eq", "slug", "leather-shoes")).toBe(true);
    expect(has(queries[0].calls, "eq", "status", "published")).toBe(true);
    expect(has(queries[0].calls, "eq", "merchants.is_test", false)).toBe(true);
  });

  it("keeps the order of the ids asked for and skips the missing", async () => {
    const { supabase } = fakeSupabase({ data: [{ id: "a" }, { id: "c" }] });
    expect((await createSupabaseCatalogue(supabase).getProductsByIds(["c", "b", "a"])).map((p) => p.id)).toEqual(["c", "a"]);
    const none = fakeSupabase();
    expect(await createSupabaseCatalogue(none.supabase).getProductsByIds([])).toEqual([]);
    expect(none.queries).toHaveLength(0);
  });

  it("lists only open shops (active store, active or approved merchant, not a test fixture), paged, with an optional name search", async () => {
    const row = { id: "s1", name: "Shop", slug: "shop", logo_url: null, status: "active", merchant_id: "m1", merchants: { status: "active", is_test: false } };
    const { supabase, queries } = fakeSupabase({ data: [row], count: 1 });
    const page = await createSupabaseCatalogue(supabase).listShops({ page: 2, pageSize: 6, search: "bo" });
    expect(page).toEqual({ items: [{ id: "s1", merchant_id: "m1", name: "Shop", slug: "shop", logo_url: null }], total: 1 });
    const calls = queries[0].calls;
    expect(has(calls, "eq", "status", "active")).toBe(true);
    expect(has(calls, "in", "merchants.status", ["active", "approved"])).toBe(true);
    expect(has(calls, "eq", "merchants.is_test", false)).toBe(true);
    expect(has(calls, "ilike", "name", "%bo%")).toBe(true);
    expect(has(calls, "range", 6, 11)).toBe(true);
  });

  it("builds shop summaries from one products query", async () => {
    const rows = [
      { store_id: "s1", name: "Shoes", created_at: "2026-01-02", categories: { name: "Clothing", name_am: null, icon: "shirt", color: "navy" }, product_images: [{ url: "b.jpg", is_primary: true }] },
      { store_id: "s1", name: "Shirt", created_at: "2026-01-01", categories: { name: "Clothing", name_am: null, icon: "shirt", color: "navy" }, product_images: [{ url: "a.jpg", is_primary: true }] },
    ];
    const { supabase, queries } = fakeSupabase({ data: rows });
    const shops = [{ id: "s1", merchant_id: "m1", name: "Shop", slug: "shop", logo_url: null }];
    const map = await createSupabaseCatalogue(supabase).getShopSummaries(shops);
    expect(queries).toHaveLength(1);
    expect(map.get("s1")).toEqual({
      categories: [{ name: "Clothing", name_am: null, icon: "shirt", color: "navy" }],
      productNames: ["Shoes", "Shirt"],
      latestProductImage: { url: "b.jpg", createdAt: "2026-01-02" },
    });
  });

  it("batches merchant ratings into one query for the distinct ids", async () => {
    const { supabase, queries } = fakeSupabase({ data: [{ id: "m1", avg_rating: 4, review_count: null }] });
    const ratings = await createSupabaseCatalogue(supabase).getMerchantRatings(["m1", "m1", "m2"]);
    expect(ratings.get("m1")).toEqual({ avg_rating: 4, review_count: 0 });
    expect(queries).toHaveLength(1);
    expect(has(queries[0].calls, "in", "id", ["m1", "m2"])).toBe(true);
  });
});
