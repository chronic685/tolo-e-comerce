import { describe, expect, it, vi } from "vitest";
import { createToloApi } from "@tolo/api-client";
import { createApiMerchantProducts, mapManagedProduct, screenStatus } from "./api";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const problem = (status: number, title: string, code?: string) => json({ title, status, code }, status);
const noContent = () => new Response(null, { status: 204 });

const summary = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  merchant_id: "m1",
  category_id: "c1",
  name: "Leather shoes",
  slug: "leather-shoes",
  status: "published",
  is_featured: true,
  price: 2400,
  discount_price: 2100,
  image_url: null,
  is_archived: false,
  updated_at: "2026-10-11T10:00:00+00:00",
  is_returnable: true,
  customer_price: 2205,
  average_rating: null,
  review_count: 0,
  in_stock: true,
  merchant_name: "Shop",
  merchant_slug: "shop",
  ...over,
});

const product = (over: Record<string, unknown> = {}, sum: Record<string, unknown> = {}) => ({
  summary: summary(sum),
  description: "Fine shoes",
  variants: [
    { id: "v1", sku: "S-1", attributes: { size: "M" }, price: 2400, discount_price: 2100, is_default: true, stock_quantity: 25, customer_price: 2205, in_stock: true },
    { id: "v2", sku: null, attributes: {}, price: 2600, discount_price: null, is_default: false, stock_quantity: 0, customer_price: 2730, in_stock: false },
  ],
  images: [{ id: "i1", url: "https://img.test/a.jpg", sort_order: 0, is_primary: true }],
  archive: null,
  ...over,
});

const category = { id: "c1", parent_id: null, name: "Clothing", name_am: "ልብስ", slug: "clothing", image_url: null, icon: "shirt", color: "navy", sort_order: 0, is_active: true };

type Call = { method: string; path: string; search: URLSearchParams; headers: Headers; body: unknown; form?: FormData };

/** A fake API: `routes` answers by "METHOD /path"; every request is recorded, whether it came from the typed client or from a raw upload. */
function setup(routes: Record<string, (call: Call) => Response>, token: string | null = null) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: Request | string, init?: RequestInit) => {
    let call: Call;
    if (typeof input === "string") {
      const url = new URL(input);
      call = { method: init?.method ?? "GET", path: url.pathname, search: url.searchParams, headers: new Headers(init?.headers), body: undefined, form: init?.body instanceof FormData ? init.body : undefined };
    } else {
      const url = new URL(input.url);
      const text = input.method === "GET" || input.method === "DELETE" ? "" : await input.clone().text();
      call = { method: input.method, path: url.pathname, search: url.searchParams, headers: input.headers, body: text ? JSON.parse(text) : undefined };
    }
    calls.push(call);
    const handler = routes[`${call.method} ${call.path}`];
    return handler ? handler(call) : problem(404, "Not found");
  });
  const api = createToloApi({ VITE_API_BASE_URL: "http://api.test", DEV: true }, { fetch: fetchMock as unknown as typeof fetch, storage: { getItem: () => token } });
  const backend = createApiMerchantProducts({ client: api.client, baseUrl: api.baseUrl, getToken: api.getAccessToken, fetch: fetchMock as unknown as typeof fetch });
  return { backend, calls, fetchMock };
}

const ref = { merchantId: "supabase-merchant", storeId: "supabase-store" };

describe("mapping", () => {
  it("maps the API's status and archive flag to the screens' statuses", () => {
    expect(screenStatus({ status: "published", is_archived: false })).toBe("published");
    expect(screenStatus({ status: "hidden", is_archived: false })).toBe("paused");
    expect(screenStatus({ status: "draft", is_archived: false })).toBe("draft");
    expect(screenStatus({ status: "hidden", is_archived: true })).toBe("archived");
  });

  it("maps a managed product with stock, the category and who archived it", () => {
    const archived = product({ archive: { at: "2026-10-10T08:00:00+00:00", by: "a1", by_kind: "staff", reason: "policy" } }, { is_archived: true, status: "hidden" });
    const p = mapManagedProduct(archived as never, new Map([["c1", { id: "c1", name: "Clothing", name_am: "ልብስ", slug: "clothing" }]]));
    expect(p).toMatchObject({ id: "p1", status: "archived", archived_at: "2026-10-10T08:00:00+00:00", archived_by_role: "staff", base_price: 2400 });
    expect(p.categories).toEqual({ name: "Clothing", name_am: "ልብስ" });
    expect(p.product_variants.map((v) => v.inventory?.stock_quantity)).toEqual([25, 0]);
    expect(p.product_images).toEqual([{ id: "i1", url: "https://img.test/a.jpg", is_primary: true }]);
  });
});

describe("listing", () => {
  it("lists a tab page with each product's detail (stock, archive) and the category names", async () => {
    const { backend, calls } = setup({
      "GET /api/merchant/products": () => json({ items: [summary(), summary({ id: "p2", status: "hidden" })], page_number: 2, page_size: 20, total: 41 }),
      "GET /api/merchant/products/p1": () => json(product()),
      "GET /api/merchant/products/p2": () => json(product({}, { id: "p2", status: "hidden", category_id: null })),
      "GET /api/customer/categories": () => json([category]),
    });
    const page = await backend.list(ref, "active", 2, 20);
    expect(page.total).toBe(41);
    expect(page.items.map((p) => [p.id, p.status, p.categories?.name ?? null])).toEqual([["p1", "published", "Clothing"], ["p2", "paused", null]]);
    const list = calls.find((c) => c.path === "/api/merchant/products")!;
    expect(Object.fromEntries(list.search)).toEqual({ archived: "false", sort: "newest", page: "2", page_size: "20" });
  });

  it("asks for the archived tab with archived=true", async () => {
    const { backend, calls } = setup({ "GET /api/merchant/products": () => json({ items: [], page_number: 1, page_size: 20, total: 0 }), "GET /api/customer/categories": () => json([]) });
    await backend.list(ref, "archived", 1, 20);
    expect(calls[0].search.get("archived")).toBe("true");
  });

  it("returns an empty page when the API refuses (for example without a token)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { backend } = setup({ "GET /api/merchant/products": () => problem(401, "Unauthorized") });
    expect(await backend.list(ref, "active", 1, 20)).toEqual({ items: [], total: 0 });
    error.mockRestore();
  });

  it("lists everything for the CSV export, a page at a time", async () => {
    const { backend, calls } = setup({
      "GET /api/merchant/products": (c) => (c.search.get("page") === "1" ? json({ items: [summary()], page_number: 1, page_size: 100, total: 2 }) : json({ items: [summary({ id: "p2" })], page_number: 2, page_size: 100, total: 2 })),
      "GET /api/merchant/products/p1": () => json(product()),
      "GET /api/merchant/products/p2": () => json(product({}, { id: "p2" })),
      "GET /api/customer/categories": () => json([category]),
    });
    expect((await backend.listAll(ref, "active")).map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(calls.filter((c) => c.path === "/api/merchant/products")).toHaveLength(2);
  });
});

describe("hide, show, archive, restore, delete", () => {
  it("shows and hides each product, and stops at the first the API refuses with its reason", async () => {
    const { backend, calls } = setup({
      "POST /api/merchant/products/a/show": () => noContent(),
      "POST /api/merchant/products/b/show": () => problem(409, "This product cannot be listed yet.", "product_not_listable"),
    });
    expect(await backend.setVisible(["a"], true)).toEqual({ ok: true });
    expect(await backend.setVisible(["b", "c"], true)).toEqual({ ok: false, error: "This product cannot be listed yet." });
    expect(calls.map((c) => c.path)).toEqual(["/api/merchant/products/a/show", "/api/merchant/products/b/show"]);
    const hide = setup({ "POST /api/merchant/products/a/hide": () => noContent() });
    expect(await hide.backend.setVisible(["a"], false)).toEqual({ ok: true });
  });

  it("archives with no reason and counts them", async () => {
    const { backend, calls } = setup({ "POST /api/merchant/products/a/archive": () => noContent(), "POST /api/merchant/products/b/archive": () => noContent() });
    expect(await backend.archive(["a", "b"])).toEqual({ ok: true, count: 2 });
    expect(calls[0].body).toEqual({ reason: null });
  });

  it("restores what it can and counts the ones the API blocks", async () => {
    const { backend } = setup({ "POST /api/merchant/products/a/restore": () => noContent(), "POST /api/merchant/products/b/restore": () => problem(409, "Not allowed.") });
    expect(await backend.restore(["a", "b"])).toEqual({ ok: true, restored: 1, blocked: 1 });
  });

  it("deletes, and reports a product that has orders so the screen can offer archiving", async () => {
    const { backend } = setup({
      "DELETE /api/merchant/products/a": () => noContent(),
      "DELETE /api/merchant/products/b": () => problem(409, "This product has been ordered, so it cannot be deleted. Archive it instead.", "product_has_orders"),
      "DELETE /api/merchant/products/c": () => problem(403, "Not yours."),
    });
    expect(await backend.remove("a")).toEqual({ ok: true });
    expect(await backend.remove("b")).toMatchObject({ ok: false, hasOrders: true });
    expect(await backend.remove("c")).toMatchObject({ ok: false, error: "Not yours.", hasOrders: false });
    expect(await backend.hasOrders("a")).toEqual({ ok: true, hasOrders: false });
  });
});

describe("loading and the form's helpers", () => {
  it("loads a product for the form", async () => {
    const { backend } = setup({ "GET /api/merchant/products/p1": () => json(product({}, { status: "hidden" })) });
    const loaded = await backend.load("p1");
    expect(loaded).toMatchObject({ name: "Leather shoes", status: "paused", categoryId: "c1", basePrice: 2400, archivedBy: null });
    expect(loaded?.variants.map((v) => [v.id, v.price, v.stock])).toEqual([["v1", 2400, 25], ["v2", 2600, 0]]);
    expect(await setup({}).backend.load("nope")).toBeNull();
  });

  it("reads the categories once and the merchant's commission rate", async () => {
    const { backend, calls } = setup({
      "GET /api/customer/categories": () => json([category]),
      "GET /api/merchant/commission": () => json({ items: [{ merchant_id: "m1", merchant_name: "Shop", rate_percent: "7.5" }] }),
    });
    expect((await backend.categories()).map((c) => c.name)).toEqual(["Clothing"]);
    await backend.categories();
    expect(calls.filter((c) => c.path === "/api/customer/categories")).toHaveLength(1);
    expect(await backend.commissionRate(ref, "c1")).toBe(7.5);
    expect(await setup({}).backend.commissionRate(ref, "c1")).toBeNull();
  });
});

describe("saving", () => {
  const variant = { sku: "S-1", attributes: { size: "M" }, price: 2400, stock: 5, isDefault: true };
  const fields = { categoryId: "c1", name: "Leather shoes", slug: "leather-shoes", description: "Fine", basePrice: 2400, status: "draft" as const };

  it("creates a product in the account's own shop, not the Supabase one, with its variants", async () => {
    const { backend, calls } = setup({
      "GET /api/merchant/merchants": () => json({ items: [{ id: "api-merchant" }], page_number: 1, page_size: 20, total: 1 }),
      "POST /api/merchant/merchants/api-merchant/products": () => json(product({}, { id: "new1", status: "draft" }), 201),
    });
    const result = await backend.save(ref, fields, [variant], []);
    expect(result).toEqual({ ok: true, productId: "new1", warnings: undefined });
    const create = calls.find((c) => c.method === "POST")!;
    expect(create.body).toEqual({
      category_id: "c1",
      name: "Leather shoes",
      slug: "leather-shoes",
      description: "Fine",
      variants: [{ sku: "S-1", attributes: { size: "M" }, price: 2400, discount_price: null, is_default: true, stock_quantity: 5 }],
    });
    expect(calls.some((c) => c.path.includes("supabase-merchant"))).toBe(false);
  });

  it("says so when the account has no shop in the API", async () => {
    const { backend } = setup({ "GET /api/merchant/merchants": () => json({ items: [], page_number: 1, page_size: 20, total: 0 }) });
    expect(await backend.save(ref, fields, [variant], [])).toEqual({ ok: false, error: "No shop is linked to this account in the API." });
  });

  it("publishes after saving when asked, and stops with the reason when the product cannot be listed", async () => {
    const { backend, calls } = setup({
      "GET /api/merchant/merchants": () => json({ items: [{ id: "api-merchant" }], page_number: 1, page_size: 20, total: 1 }),
      "POST /api/merchant/merchants/api-merchant/products": () => json(product({}, { id: "new1", status: "draft" }), 201),
      "POST /api/merchant/products/new1/show": () => noContent(),
    });
    expect(await backend.save(ref, { ...fields, status: "published" }, [variant], [])).toMatchObject({ ok: true, productId: "new1" });
    expect(calls.at(-1)?.path).toBe("/api/merchant/products/new1/show");

    const refused = setup({
      "GET /api/merchant/merchants": () => json({ items: [{ id: "api-merchant" }], page_number: 1, page_size: 20, total: 1 }),
      "POST /api/merchant/merchants/api-merchant/products": () => json(product({}, { id: "new1", status: "draft" }), 201),
      "POST /api/merchant/products/new1/show": () => problem(409, "Give every variant a price and some stock first.", "product_not_listable"),
    });
    expect(await refused.backend.save(ref, { ...fields, status: "published" }, [variant], [])).toEqual({ ok: false, error: "Give every variant a price and some stock first." });
  });

  it("updates a product keeping what the form does not edit (featured, returnable, a variant's discount) and hides it when paused", async () => {
    const { backend, calls } = setup({
      "GET /api/merchant/products/p1": () => json(product()),
      "PUT /api/merchant/products/p1": () => json(product()),
      "PUT /api/merchant/products/p1/variants": () => json(product()),
      "POST /api/merchant/products/p1/hide": () => noContent(),
    });
    const result = await backend.save(ref, { ...fields, status: "paused" }, [{ ...variant, id: "v1" }, { sku: null, attributes: {}, price: 100, stock: 1, isDefault: false }], [], "p1");
    expect(result.ok).toBe(true);
    expect(calls.find((c) => c.method === "PUT" && c.path === "/api/merchant/products/p1")?.body).toMatchObject({ is_featured: true, is_returnable: true, name: "Leather shoes" });
    expect(calls.find((c) => c.path.endsWith("/variants"))?.body).toEqual([
      { sku: "S-1", attributes: { size: "M" }, price: 2400, discount_price: 2100, is_default: true, stock_quantity: 5 },
      { sku: null, attributes: {}, price: 100, discount_price: null, is_default: false, stock_quantity: 1 },
    ]);
    expect(calls.at(-1)?.path).toBe("/api/merchant/products/p1/hide");
  });

  it("reports a variant the API will not drop", async () => {
    const { backend } = setup({
      "GET /api/merchant/products/p1": () => json(product()),
      "PUT /api/merchant/products/p1": () => json(product()),
      "PUT /api/merchant/products/p1/variants": () => problem(409, "A customer ordered this variant.", "variant_in_use"),
    });
    expect(await backend.save(ref, fields, [variant], [], "p1")).toEqual({ ok: false, error: "A customer ordered this variant.", variantInUse: true });
  });

  it("uploads a chosen file as the form field 'file' with the token, and removes the pictures taken out", async () => {
    const { backend, calls } = setup(
      {
        "GET /api/merchant/products/p1": () => json(product()),
        "PUT /api/merchant/products/p1": () => json(product()),
        "PUT /api/merchant/products/p1/variants": () => json(product()),
        "POST /api/merchant/products/p1/images": () => json({ id: "i2", url: "x", sort_order: 1, is_primary: false }, 201),
        "DELETE /api/merchant/products/p1/images/i1": () => noContent(),
      },
      "dev-token",
    );
    const file = new File([new Uint8Array([1, 2, 3])], "front.jpg", { type: "image/jpeg" });
    const result = await backend.save(ref, fields, [variant], [{ id: "i1", url: "https://img.test/a.jpg" }, { url: "blob:local", file }], "p1", { variantIds: [], imageIds: ["i1"] });
    expect(result).toMatchObject({ ok: true, productId: "p1" });
    const upload = calls.find((c) => c.path === "/api/merchant/products/p1/images")!;
    expect(upload.headers.get("Authorization")).toBe("Bearer dev-token");
    expect((upload.form?.get("file") as File).name).toBe("front.jpg");
    expect(calls.some((c) => c.method === "DELETE" && c.path.endsWith("/images/i1"))).toBe(true);
    // a picture already stored is not uploaded again
    expect(calls.filter((c) => c.path.endsWith("/images") && c.method === "POST")).toHaveLength(1);
  });

  it("copies a picture given as a link, and keeps the product when the link cannot be read", async () => {
    const readable = setup({
      "GET /api/merchant/products/p1": () => json(product()),
      "PUT /api/merchant/products/p1": () => json(product()),
      "PUT /api/merchant/products/p1/variants": () => json(product()),
      "GET /pic.jpg": () => new Response(new Uint8Array([1, 2]), { status: 200, headers: { "Content-Type": "image/jpeg" } }),
      "POST /api/merchant/products/p1/images": () => json({ id: "i2", url: "x", sort_order: 1, is_primary: false }, 201),
    });
    const ok = await readable.backend.save(ref, fields, [variant], [{ url: "http://api.test/pic.jpg" }], "p1");
    expect(ok).toMatchObject({ ok: true, warnings: undefined });
    expect(readable.calls.some((c) => c.path === "/api/merchant/products/p1/images")).toBe(true);

    const blocked = setup({
      "GET /api/merchant/products/p1": () => json(product()),
      "PUT /api/merchant/products/p1": () => json(product()),
      "PUT /api/merchant/products/p1/variants": () => json(product()),
    });
    blocked.fetchMock.mockImplementationOnce(blocked.fetchMock.getMockImplementation()!);
    const original = blocked.fetchMock.getMockImplementation()!;
    blocked.fetchMock.mockImplementation(async (input, init) => {
      if (typeof input === "string" && input.includes("unreachable")) throw new TypeError("Failed to fetch");
      return original(input, init);
    });
    const result = await blocked.backend.save(ref, fields, [variant], [{ url: "https://unreachable.test/p.jpg" }], "p1");
    expect(result.ok).toBe(true);
    expect(result.ok && result.warnings?.[0]).toContain("could not be read from here");
  });
});
