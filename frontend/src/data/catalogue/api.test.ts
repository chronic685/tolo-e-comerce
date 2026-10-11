import { describe, expect, it, vi } from "vitest";
import { createToloApi } from "@tolo/api-client";
import { createApiCatalogue, mapProductDetail, mapProductSummary, mapStorefront, stockStatus } from "./api";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const summary = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  merchant_id: "m1",
  category_id: "c1",
  name: "Leather shoes",
  slug: "demo-01-leather-shoes",
  status: "published",
  is_featured: false,
  price: 2400,
  discount_price: 2100,
  image_url: "https://img.test/shoe.jpg",
  is_archived: false,
  updated_at: "2026-10-11T10:00:00+00:00",
  is_returnable: true,
  customer_price: 2205,
  average_rating: 4.5,
  review_count: 3,
  ...over,
});

const merchant = (over: Record<string, unknown> = {}) => ({
  id: "m1",
  business_name: "[DEMO] Bole Fashion",
  category_id: "c1",
  category_name: "Clothing",
  description: "Demo store",
  logo_url: null,
  banner_url: null,
  address: "Addis Ababa",
  city: "Addis Ababa",
  sub_city: null,
  woreda: null,
  landmark: null,
  latitude: null,
  longitude: null,
  created_at: "2026-10-11T10:00:00+00:00",
  open_now: true,
  average_rating: 4.2,
  review_count: 10,
  ...over,
});

const category = (id: string, name: string) => ({ id, parent_id: null, name, name_am: null, slug: name.toLowerCase(), image_url: null, icon: "shirt", color: "navy", sort_order: 0, is_active: true });

/** A catalogue over a fake API: `routes` answers by method+path, and every request is recorded. */
function setup(routes: Record<string, (url: URL) => Response>) {
  const requests: URL[] = [];
  const fetchMock = vi.fn(async (request: Request) => {
    const url = new URL(request.url);
    requests.push(url);
    const handler = routes[`${request.method} ${url.pathname}`];
    return handler ? handler(url) : json({ title: "Not found" }, 404);
  });
  const api = createToloApi({ VITE_API_BASE_URL: "http://api.test" }, { fetch: fetchMock as unknown as typeof fetch });
  return { catalogue: createApiCatalogue(api.client), requests, fetchMock };
}

describe("mapping", () => {
  it("maps a product summary to the shape the cards use, with the id as the URL identifier", () => {
    const p = mapProductSummary(summary() as never);
    expect(p).toMatchObject({ id: "p1", slug: "p1", store_id: "m1", base_price: 2400, discount_price: 2100, customer_price: 2205, status: "published" });
    expect(p.product_images).toEqual([{ id: "p1-primary", url: "https://img.test/shoe.jpg", is_primary: true, variant_id: null }]);
    expect(p.product_variants).toEqual([]);
  });

  it("copes with a product without an image or discount and with numbers sent as strings", () => {
    const p = mapProductSummary(summary({ image_url: null, discount_price: null, price: "1200.50", customer_price: "1260.53" }) as never);
    expect(p.product_images).toEqual([]);
    expect(p.discount_price).toBeNull();
    expect(p.base_price).toBe(1200.5);
    expect(p.customer_price).toBe(1260.53);
  });

  it("never exposes raw stock: out, low (capped count) or in stock", () => {
    expect(stockStatus(0)).toEqual({ stock_status: "out_of_stock", stock_remaining: null });
    expect(stockStatus(3)).toEqual({ stock_status: "low", stock_remaining: 3 });
    expect(stockStatus(5)).toEqual({ stock_status: "low", stock_remaining: 5 });
    expect(stockStatus(6)).toEqual({ stock_status: "in_stock", stock_remaining: null });
  });

  it("maps a product with variants, images and its merchant", () => {
    const detail = {
      summary: summary(),
      description: "Fine shoes",
      variants: [
        { id: "v1", sku: "S-1", attributes: { size: "M" }, price: 2400, discount_price: 2100, is_default: true, stock_quantity: 25, customer_price: 2205 },
        { id: "v2", sku: null, attributes: {}, price: 2400, discount_price: null, is_default: false, stock_quantity: 0, customer_price: 2520 },
      ],
      images: [{ id: "i1", url: "https://img.test/a.jpg", sort_order: 1, is_primary: true }],
    };
    const p = mapProductDetail(detail as never, merchant() as never);
    expect(p.description).toBe("Fine shoes");
    expect(p.product_variants.map((v) => [v.id, v.customer_price, v.stock_status])).toEqual([
      ["v1", 2205, "in_stock"],
      ["v2", 2520, "out_of_stock"],
    ]);
    expect(p.product_images[0]).toMatchObject({ id: "i1", sort_order: 1, is_primary: true });
    expect(p.stores).toEqual({ name: "[DEMO] Bole Fashion", slug: "m1", logo_url: null });
    expect(p.merchants).toEqual({ avg_rating: 4.2, review_count: 10 });
  });

  it("maps a merchant to a storefront that is open for business", () => {
    expect(mapStorefront(merchant({ open_now: false }) as never)).toMatchObject({ id: "m1", merchant_id: "m1", slug: "m1", status: "active", is_open_now: false, name: "[DEMO] Bole Fashion" });
  });
});

describe("api catalogue", () => {
  it("lists categories", async () => {
    const { catalogue } = setup({ "GET /api/customer/categories": () => json([category("c1", "Clothing")]) });
    expect(await catalogue.listCategories()).toEqual([{ id: "c1", name: "Clothing", name_am: null, slug: "clothing", icon: "shirt", color: "navy" }]);
  });

  it("sends search, category, price range, sort and page; price filters are the API's customer-price filters", async () => {
    const { catalogue, requests } = setup({
      "GET /api/customer/products": () => json({ items: [summary()], page_number: 2, page_size: 12, total: 25 }),
    });
    const page = await catalogue.listProducts({ page: 2, pageSize: 12, categoryId: "c1", search: " shoe ", minPrice: 500, maxPrice: 3000, sort: "price_desc" });
    expect(page.total).toBe(25);
    expect(page.items.map((p) => p.id)).toEqual(["p1"]);
    expect(Object.fromEntries(requests[0].searchParams)).toEqual({ q: "shoe", category_id: "c1", min_price: "500", max_price: "3000", sort: "price_desc", page: "2", page_size: "12" });
  });

  it("maps rating order and lets a search rank by relevance unless a sort was chosen", async () => {
    const { catalogue, requests } = setup({ "GET /api/customer/products": () => json({ items: [], page_number: 1, page_size: 12, total: 0 }) });
    await catalogue.listProducts({ page: 1, pageSize: 12, sort: "rating_desc" });
    await catalogue.listProducts({ page: 1, pageSize: 12, search: "hoe", sort: "newest" });
    await catalogue.listProducts({ page: 1, pageSize: 12, search: "hoe", sort: "price_asc" });
    await catalogue.listProducts({ page: 1, pageSize: 12 });
    expect(requests.map((u) => u.searchParams.get("sort"))).toEqual(["rating", null, "price_asc", "newest"]);
  });

  it("filters a shop's products by merchant and featured products by flag", async () => {
    const { catalogue, requests } = setup({ "GET /api/customer/products": () => json({ items: [], page_number: 1, page_size: 10, total: 0 }) });
    await catalogue.listProducts({ page: 1, pageSize: 10, storeId: "m1" });
    await catalogue.listProducts({ page: 1, pageSize: 10, featured: true });
    expect(requests[0].searchParams.get("merchant_id")).toBe("m1");
    expect(requests[1].searchParams.get("featured")).toBe("true");
  });

  it("returns an empty page rather than throwing when the API fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { catalogue } = setup({ "GET /api/customer/products": () => json({ title: "boom" }, 500) });
    expect(await catalogue.listProducts({ page: 1, pageSize: 12 })).toEqual({ items: [], total: 0 });
    error.mockRestore();
  });

  it("gets one product with its merchant's name and rating, or null when it does not exist", async () => {
    const detail = { summary: summary(), description: "Fine", variants: [], images: [] };
    const { catalogue, requests } = setup({
      "GET /api/customer/products/p1": () => json(detail),
      "GET /api/customer/merchants/m1": () => json(merchant()),
    });
    const p = await catalogue.getProduct("p1");
    expect(p?.stores?.name).toBe("[DEMO] Bole Fashion");
    expect(await catalogue.getProduct("old-slug-not-an-id")).toBeNull();
    expect(requests.map((u) => u.pathname)).toEqual(["/api/customer/products/p1", "/api/customer/merchants/m1", "/api/customer/products/old-slug-not-an-id"]);
  });

  it("gets products by id in the order given, leaving out the ones that are gone", async () => {
    const one = (id: string) => ({ summary: summary({ id, name: id }), description: null, variants: [], images: [] });
    const { catalogue } = setup({ "GET /api/customer/products/a": () => json(one("a")), "GET /api/customer/products/c": () => json(one("c")) });
    expect((await catalogue.getProductsByIds(["c", "b", "a"])).map((p) => p.id)).toEqual(["c", "a"]);
  });

  it("lists shops, which are merchants, and remembers their ratings", async () => {
    const { catalogue, requests } = setup({
      "GET /api/customer/merchants": () => json({ items: [merchant()], page_number: 1, page_size: 12, total: 1 }),
    });
    const page = await catalogue.listShops({ page: 1, pageSize: 12, search: "bole" });
    expect(page).toEqual({ items: [{ id: "m1", merchant_id: "m1", name: "[DEMO] Bole Fashion", slug: "m1", logo_url: null }], total: 1 });
    expect(requests[0].searchParams.get("q")).toBe("bole");
    // listing filled the cache: no per-merchant request is needed for the ratings
    expect((await catalogue.getMerchantRatings(["m1", "m1"])).get("m1")).toEqual({ avg_rating: 4.2, review_count: 10 });
    expect(requests).toHaveLength(1);
  });

  it("fetches each distinct merchant's rating once", async () => {
    const { catalogue, requests } = setup({ "GET /api/customer/merchants/m2": () => json(merchant({ id: "m2", average_rating: null, review_count: 0 })) });
    const ratings = await catalogue.getMerchantRatings(["m2", "m2", "gone"]);
    expect(ratings.get("m2")).toEqual({ avg_rating: null, review_count: 0 });
    expect(ratings.has("gone")).toBe(false);
    expect(requests.filter((u) => u.pathname.endsWith("/m2"))).toHaveLength(1);
  });

  it("gets a storefront by id, or null", async () => {
    const { catalogue } = setup({ "GET /api/customer/merchants/m1": () => json(merchant()) });
    expect((await catalogue.getStorefront("m1"))?.name).toBe("[DEMO] Bole Fashion");
    expect(await catalogue.getStorefront("nope")).toBeNull();
  });

  it("derives a shop's category pills from its products and the category list", async () => {
    const { catalogue } = setup({
      "GET /api/customer/products": () => json({ items: [summary({ category_id: "c2" }), summary({ id: "p2", category_id: "c2" }), summary({ id: "p3", category_id: null })], page_number: 1, page_size: 100, total: 3 }),
      "GET /api/customer/categories": () => json([category("c1", "Clothing"), category("c2", "Food")]),
    });
    const store = mapStorefront(merchant() as never);
    expect((await catalogue.listStoreCategories(store)).map((c) => c.name)).toEqual(["Food"]);
  });

  it("summarises each shop from its newest products", async () => {
    const { catalogue } = setup({
      "GET /api/customer/products": () => json({ items: [summary({ name: "Leather shoes" }), summary({ id: "p2", name: "Shirt", category_id: "c1", image_url: null })], page_number: 1, page_size: 20, total: 2 }),
      "GET /api/customer/categories": () => json([category("c1", "Clothing")]),
    });
    const shop = { id: "m1", merchant_id: "m1", name: "Shop", slug: "m1", logo_url: null };
    const map = await catalogue.getShopSummaries([shop]);
    expect(map.get("m1")).toMatchObject({ categories: [{ name: "Clothing" }], productNames: ["Leather shoes", "Shirt"], latestProductImage: { url: "https://img.test/shoe.jpg" } });
  });
});
