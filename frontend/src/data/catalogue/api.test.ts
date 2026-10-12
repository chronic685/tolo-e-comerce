import { describe, expect, it, vi } from "vitest";
import { createToloApi } from "@tolo/api-client";
import { MAX_IDS, createApiCatalogue, mapProductDetail, mapProductSummary, mapShopSummary, mapStorefront } from "./api";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const summary = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  merchant_id: "m1",
  category_id: "c1",
  name: "Leather shoes",
  slug: "leather-shoes",
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
  in_stock: true,
  merchant_name: "[DEMO] Bole Fashion",
  merchant_slug: "demo-bole-fashion-a1b2c3d4",
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
  slug: "demo-bole-fashion-a1b2c3d4",
  weekly_hours: { sun: null, mon: { open: "09:00", close: "21:00" }, tue: null, wed: null, thu: null, fri: null, sat: { open: "10:00", close: "14:30" } },
  prep_time_minutes: 25,
  product_count: 3,
  categories: [{ id: "c1", name: "Clothing", name_am: "ልብስ", icon: "shirt", color: "navy" }],
  sample_product_names: ["Leather shoes", "Shirt"],
  latest_product_image_url: "https://img.test/shoe.jpg",
  ...over,
});

const category = (id: string, name: string) => ({ id, parent_id: null, name, name_am: null, slug: name.toLowerCase(), image_url: null, icon: "shirt", color: "navy", sort_order: 0, is_active: true });

const detail = (over: Record<string, unknown> = {}) => ({
  summary: summary(),
  description: "Fine shoes",
  variants: [
    { id: "v1", sku: "S-1", attributes: { size: "M" }, price: 2400, discount_price: 2100, is_default: true, customer_price: 2205, in_stock: true, max_order_quantity: 10 },
    { id: "v2", sku: null, attributes: {}, price: 2400, discount_price: null, is_default: false, customer_price: 2520, in_stock: false, max_order_quantity: 0 },
  ],
  images: [{ id: "i1", url: "https://img.test/a.jpg", sort_order: 1, is_primary: true }],
  archive: null,
  ...over,
});

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

const page = (items: unknown[], total = items.length) => json({ items, page_number: 1, page_size: 20, total });

describe("mapping", () => {
  it("maps a product summary to the shape the cards use, with its real slug, shop link and stock flag", () => {
    const p = mapProductSummary(summary() as never);
    expect(p).toMatchObject({ id: "p1", slug: "leather-shoes", store_id: "m1", base_price: 2400, discount_price: 2100, customer_price: 2205, status: "published", in_stock: true });
    expect(p.stores).toEqual({ name: "[DEMO] Bole Fashion", slug: "demo-bole-fashion-a1b2c3d4" });
    expect(p.product_images).toEqual([{ id: "p1-primary", url: "https://img.test/shoe.jpg", is_primary: true, variant_id: null }]);
    expect(p.product_variants).toEqual([]);
  });

  it("copes with a product without an image, discount or shop name, and with numbers sent as strings", () => {
    const p = mapProductSummary(summary({ image_url: null, discount_price: null, price: "1200.50", customer_price: "1260.53", in_stock: false, merchant_name: null, merchant_slug: null }) as never);
    expect(p.product_images).toEqual([]);
    expect(p.discount_price).toBeNull();
    expect(p.base_price).toBe(1200.5);
    expect(p.customer_price).toBe(1260.53);
    expect(p.in_stock).toBe(false);
    expect(p.stores).toBeNull();
  });

  it("maps variants to in stock or out of stock with the per-order limit, and no count of what is left", () => {
    const p = mapProductDetail(detail() as never, merchant() as never);
    expect(p.product_variants.map((v) => [v.id, v.customer_price, v.stock_status, v.stock_remaining, v.max_order_quantity])).toEqual([
      ["v1", 2205, "in_stock", null, 10],
      ["v2", 2520, "out_of_stock", null, 0],
    ]);
    expect(p.description).toBe("Fine shoes");
    expect(p.product_images[0]).toMatchObject({ id: "i1", sort_order: 1, is_primary: true });
    expect(p.stores).toEqual({ name: "[DEMO] Bole Fashion", slug: "demo-bole-fashion-a1b2c3d4", logo_url: null });
    expect(p.merchants).toEqual({ avg_rating: 4.2, review_count: 10 });
  });

  it("maps a merchant to a storefront with its weekly hours, prep time and open-now flag", () => {
    const store = mapStorefront(merchant({ open_now: false }) as never);
    expect(store).toMatchObject({ id: "m1", merchant_id: "m1", slug: "demo-bole-fashion-a1b2c3d4", status: "active", is_open_now: false, prep_time_minutes: 25 });
    expect(store.operating_hours.mon).toEqual({ open: "09:00", close: "21:00" });
    expect(store.operating_hours.tue).toBeNull();
    expect(store.merchants).toEqual({ status: "active", avg_rating: 4.2, review_count: 10 });
  });

  it("a shop with no hours or prep time set has empty hours and no prep time", () => {
    const store = mapStorefront(merchant({ weekly_hours: null, prep_time_minutes: null }) as never);
    expect(store.operating_hours).toEqual({});
    expect(store.prep_time_minutes).toBeNull();
  });

  it("maps a shop's summary fields", () => {
    expect(mapShopSummary(merchant() as never)).toEqual({
      categories: [{ name: "Clothing", name_am: "ልብስ", icon: "shirt", color: "navy" }],
      productNames: ["Leather shoes", "Shirt"],
      latestProductImage: { url: "https://img.test/shoe.jpg", createdAt: "" },
    });
    expect(mapShopSummary(merchant({ categories: null, sample_product_names: null, latest_product_image_url: null }) as never)).toEqual({ categories: [], productNames: [], latestProductImage: null });
  });
});

describe("api catalogue", () => {
  it("lists categories", async () => {
    const { catalogue } = setup({ "GET /api/customer/categories": () => json([category("c1", "Clothing")]) });
    expect(await catalogue.listCategories()).toEqual([{ id: "c1", name: "Clothing", name_am: null, slug: "clothing", icon: "shirt", color: "navy" }]);
  });

  it("sends search, category, price range, sort and page", async () => {
    const { catalogue, requests } = setup({ "GET /api/customer/products": () => page([summary()], 25) });
    const result = await catalogue.listProducts({ page: 2, pageSize: 12, categoryId: "c1", search: " shoe ", minPrice: 500, maxPrice: 3000, sort: "price_desc" });
    expect(result.total).toBe(25);
    expect(result.items.map((p) => p.id)).toEqual(["p1"]);
    expect(Object.fromEntries(requests[0].searchParams)).toEqual({ q: "shoe", category_id: "c1", min_price: "500", max_price: "3000", sort: "price_desc", page: "2", page_size: "12" });
  });

  it("maps rating order and lets a search rank by relevance unless a sort was chosen", async () => {
    const { catalogue, requests } = setup({ "GET /api/customer/products": () => page([]) });
    await catalogue.listProducts({ page: 1, pageSize: 12, sort: "rating_desc" });
    await catalogue.listProducts({ page: 1, pageSize: 12, search: "hoe", sort: "newest" });
    await catalogue.listProducts({ page: 1, pageSize: 12, search: "hoe", sort: "price_asc" });
    await catalogue.listProducts({ page: 1, pageSize: 12 });
    expect(requests.map((u) => u.searchParams.get("sort"))).toEqual(["rating", null, "price_asc", "newest"]);
  });

  it("filters a shop's products by merchant and featured products by flag", async () => {
    const { catalogue, requests } = setup({ "GET /api/customer/products": () => page([]) });
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

  it("gets a product by its slug (or id) with its shop's name and rating, or null when it does not exist", async () => {
    const { catalogue, requests } = setup({
      "GET /api/customer/products/leather-shoes": () => json(detail()),
      "GET /api/customer/merchants/m1": () => json(merchant()),
    });
    const p = await catalogue.getProduct("leather-shoes");
    expect(p?.slug).toBe("leather-shoes");
    expect(p?.stores?.name).toBe("[DEMO] Bole Fashion");
    expect(await catalogue.getProduct("no-such-slug")).toBeNull();
    expect(requests.map((u) => u.pathname)).toEqual(["/api/customer/products/leather-shoes", "/api/customer/merchants/m1", "/api/customer/products/no-such-slug"]);
  });

  it("gets products by id in ONE request, in the order given, leaving out the ones that are gone", async () => {
    const { catalogue, requests } = setup({
      "GET /api/customer/products": () => page([summary({ id: "a", slug: "a" }), summary({ id: "c", slug: "c" })]),
    });
    expect((await catalogue.getProductsByIds(["c", "b", "a"])).map((p) => p.id)).toEqual(["c", "a"]);
    expect(requests).toHaveLength(1);
    expect(requests[0].searchParams.get("ids")).toBe("c,b,a");
    expect(requests[0].searchParams.get("page_size")).toBe("3");
  });

  it("splits more ids than the API takes into several requests", async () => {
    const { catalogue, requests } = setup({ "GET /api/customer/products": () => page([]) });
    const ids = Array.from({ length: MAX_IDS + 5 }, (_, i) => `id${i}`);
    await catalogue.getProductsByIds(ids);
    expect(requests.map((u) => u.searchParams.get("ids")!.split(",").length)).toEqual([MAX_IDS, 5]);
    const none = setup({});
    expect(await none.catalogue.getProductsByIds([])).toEqual([]);
    expect(none.requests).toHaveLength(0);
  });

  it("lists shops, which are merchants, with their real slugs, and remembers them", async () => {
    const { catalogue, requests } = setup({ "GET /api/customer/merchants": () => page([merchant()]) });
    const shops = await catalogue.listShops({ page: 1, pageSize: 12, search: "bole" });
    expect(shops).toEqual({ items: [{ id: "m1", merchant_id: "m1", name: "[DEMO] Bole Fashion", slug: "demo-bole-fashion-a1b2c3d4", logo_url: null }], total: 1 });
    expect(requests[0].searchParams.get("q")).toBe("bole");
    expect(requests[0].searchParams.get("sort")).toBeNull(); // a search ranks by relevance
    await catalogue.listShops({ page: 2, pageSize: 12 });
    expect(requests[1].searchParams.get("sort")).toBe("name"); // browsing is by name
    expect(requests[1].searchParams.get("q")).toBeNull();
    requests.length = 0;
    // ratings and summaries come from what the list already returned: no more requests
    expect((await catalogue.getMerchantRatings(["m1", "m1"])).get("m1")).toEqual({ avg_rating: 4.2, review_count: 10 });
    const summaries = await catalogue.getShopSummaries(shops.items);
    expect(summaries.get("m1")?.productNames).toEqual(["Leather shoes", "Shirt"]);
    expect(requests).toHaveLength(0);
  });

  it("asks for the ratings and summaries of shops it has not seen in one batched request", async () => {
    const { catalogue, requests } = setup({
      "GET /api/customer/merchants": () => page([merchant({ id: "m2", slug: "two", average_rating: null, review_count: 0 }), merchant({ id: "m3", slug: "three" })]),
    });
    const ratings = await catalogue.getMerchantRatings(["m2", "m3", "m2", "gone"]);
    expect(ratings.get("m2")).toEqual({ avg_rating: null, review_count: 0 });
    expect(ratings.has("gone")).toBe(false);
    expect(requests).toHaveLength(1);
    expect(requests[0].searchParams.get("ids")).toBe("m2,m3,gone");
    const shops = [{ id: "m2", merchant_id: "m2", name: "Two", slug: "two", logo_url: null }];
    expect((await catalogue.getShopSummaries(shops)).has("m2")).toBe(true);
    expect(requests).toHaveLength(1);
  });

  it("gets a storefront by slug once and remembers it by slug and id", async () => {
    const { catalogue, requests } = setup({ "GET /api/customer/merchants/demo-bole-fashion-a1b2c3d4": () => json(merchant()) });
    expect((await catalogue.getStorefront("demo-bole-fashion-a1b2c3d4"))?.name).toBe("[DEMO] Bole Fashion");
    expect((await catalogue.getStorefront("m1"))?.name).toBe("[DEMO] Bole Fashion");
    expect(await catalogue.getStorefront("nope")).toBeNull();
    expect(requests.map((u) => u.pathname)).toEqual(["/api/customer/merchants/demo-bole-fashion-a1b2c3d4", "/api/customer/merchants/nope"]);
  });

  it("derives a shop's category pills from its products and the category list", async () => {
    const { catalogue } = setup({
      "GET /api/customer/products": () => page([summary({ category_id: "c2" }), summary({ id: "p2", category_id: "c2" }), summary({ id: "p3", category_id: null })]),
      "GET /api/customer/categories": () => json([category("c1", "Clothing"), category("c2", "Food")]),
    });
    const store = mapStorefront(merchant() as never);
    expect((await catalogue.listStoreCategories(store)).map((c) => c.name)).toEqual(["Food"]);
  });
});
