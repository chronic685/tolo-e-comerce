import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@tolo/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tolo/ui")>()),
  compressImage: vi.fn(async (file: File) => file),
}));

import { createSupabaseMerchantProducts } from "./supabase";

type Call = [method: string, ...args: unknown[]];
type Result = { data?: unknown; count?: number | null; error?: { message: string; code?: string } | null };

/** A stand-in for the Supabase client: every query-builder call is recorded per statement, and awaiting a statement yields what `respond` says for it. */
function fakeSupabase(respond: (statement: { table: string; calls: Call[] }) => Result = () => ({ data: [], count: 0 })) {
  const statements: { table: string; calls: Call[] }[] = [];
  const builder = (statement: { table: string; calls: Call[] }) => {
    const b: Record<string, unknown> = new Proxy(
      {},
      {
        get(_t, method: string) {
          if (method === "then") return (resolve: (v: unknown) => void) => resolve({ error: null, ...respond(statement) });
          return (...args: unknown[]) => {
            statement.calls.push([method, ...args]);
            return b;
          };
        },
      },
    );
    return b;
  };
  const upload = vi.fn(async () => ({ error: null }));
  const invoke = vi.fn(async () => ({ data: { rate_percent: 8 } }));
  const client = {
    from(table: string) {
      const statement = { table, calls: [] as Call[] };
      statements.push(statement);
      return builder(statement);
    },
    rpc(name: string, args: unknown) {
      const statement = { table: `rpc:${name}`, calls: [["rpc", name, args]] as Call[] };
      statements.push(statement);
      return builder(statement);
    },
    storage: { from: () => ({ upload, getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.test/${path}` } }) }) },
    functions: { invoke },
  };
  return { supabase: client as unknown as SupabaseClient, statements, upload, invoke };
}

const has = (calls: Call[], ...expected: unknown[]) => calls.some((c) => c.length === expected.length && expected.every((e, i) => JSON.stringify(e) === JSON.stringify(c[i])));
const ref = { merchantId: "m1", storeId: "s1" };

describe("supabase merchant products (the writes the screens made, behind the adapter)", () => {
  it("lists the active tab without archived products and the archived tab with only those, newest first, one page", async () => {
    const { supabase, statements } = fakeSupabase(() => ({ data: [{ id: "p1" }], count: 41 }));
    const backend = createSupabaseMerchantProducts(supabase);
    expect(await backend.list(ref, "active", 3, 20)).toEqual({ items: [{ id: "p1" }], total: 41 });
    await backend.list(ref, "archived", 1, 20);
    const [active, archived] = statements;
    expect(has(active.calls, "eq", "merchant_id", "m1")).toBe(true);
    expect(has(active.calls, "neq", "status", "archived")).toBe(true);
    expect(has(active.calls, "order", "created_at", { ascending: false })).toBe(true);
    expect(has(active.calls, "range", 40, 59)).toBe(true);
    expect(has(archived.calls, "eq", "status", "archived")).toBe(true);
  });

  it("reads the whole list a thousand rows at a time", async () => {
    const full = Array.from({ length: 1000 }, (_, i) => ({ id: `p${i}` }));
    let call = 0;
    const { supabase, statements } = fakeSupabase(() => ({ data: call++ === 0 ? full : [{ id: "last" }] }));
    expect((await createSupabaseMerchantProducts(supabase).listAll(ref, "active")).length).toBe(1001);
    expect(has(statements[0].calls, "range", 0, 999)).toBe(true);
    expect(has(statements[1].calls, "range", 1000, 1999)).toBe(true);
  });

  it("hides and shows by setting the status to paused or published", async () => {
    const { supabase, statements } = fakeSupabase();
    const backend = createSupabaseMerchantProducts(supabase);
    expect(await backend.setVisible(["a", "b"], false)).toEqual({ ok: true });
    await backend.setVisible(["a"], true);
    expect(has(statements[0].calls, "update", { status: "paused" })).toBe(true);
    expect(has(statements[0].calls, "in", "id", ["a", "b"])).toBe(true);
    expect(has(statements[1].calls, "update", { status: "published" })).toBe(true);
    expect(await createSupabaseMerchantProducts(fakeSupabase(() => ({ error: { message: "nope" } })).supabase).setVisible(["a"], true)).toEqual({ ok: false, error: "nope" });
  });

  it("archives and restores through the database functions", async () => {
    const { supabase, statements } = fakeSupabase((s) => (s.table === "rpc:restore_products" ? { data: { restored: 2, blocked: 1 } } : { data: 3 }));
    const backend = createSupabaseMerchantProducts(supabase);
    expect(await backend.archive(["a", "b", "c"])).toEqual({ ok: true, count: 3 });
    expect(await backend.restore(["a", "b", "c"])).toEqual({ ok: true, restored: 2, blocked: 1 });
    expect(statements[0].calls[0]).toEqual(["rpc", "archive_products", { p_ids: ["a", "b", "c"] }]);
    expect(statements[1].calls[0]).toEqual(["rpc", "restore_products", { p_ids: ["a", "b", "c"] }]);
  });

  it("asks the database whether an order refers to a product before offering delete, and deletes", async () => {
    const { supabase, statements } = fakeSupabase((s) => (s.table === "rpc:product_has_orders" ? { data: true } : {}));
    const backend = createSupabaseMerchantProducts(supabase);
    expect(await backend.hasOrders("p1")).toEqual({ ok: true, hasOrders: true });
    expect(statements[0].calls[0]).toEqual(["rpc", "product_has_orders", { p_product_id: "p1" }]);
    expect(await backend.remove("p1")).toEqual({ ok: true });
    expect(has(statements[1].calls, "delete")).toBe(true);
    expect(has(statements[1].calls, "eq", "id", "p1")).toBe(true);
  });

  it("loads a product for the form with its stock and low-stock threshold", async () => {
    const row = {
      name: "Shoes",
      description: null,
      category_id: "c1",
      base_price: "2400",
      status: "published",
      archived_by_role: null,
      product_variants: [{ id: "v1", sku: null, attributes: { size: "M" }, price: 2400, inventory: { stock_quantity: 7, low_stock_threshold: 3 } }, { id: "v2", sku: "X", attributes: null, price: 5, inventory: null }],
      product_images: [{ id: "i1", url: "https://img.test/a.jpg" }],
    };
    const { supabase } = fakeSupabase(() => ({ data: row }));
    const loaded = await createSupabaseMerchantProducts(supabase).load("p1");
    expect(loaded).toMatchObject({ name: "Shoes", description: null, categoryId: "c1", basePrice: 2400, status: "published", archivedBy: null });
    expect(loaded?.variants).toEqual([
      { id: "v1", sku: null, attributes: { size: "M" }, price: 2400, stock: 7, lowStockThreshold: 3 },
      { id: "v2", sku: "X", attributes: {}, price: 5, stock: 0, lowStockThreshold: 5 },
    ]);
    expect(await createSupabaseMerchantProducts(fakeSupabase(() => ({ data: null })).supabase).load("nope")).toBeNull();
  });

  it("reads the active categories and the commission rate for the shop and category", async () => {
    const { supabase, statements, invoke } = fakeSupabase(() => ({ data: [{ id: "c1" }] }));
    const backend = createSupabaseMerchantProducts(supabase);
    expect(await backend.categories()).toEqual([{ id: "c1" }]);
    expect(has(statements[0].calls, "eq", "is_active", true)).toBe(true);
    expect(await backend.commissionRate(ref, "c1")).toBe(8);
    expect(invoke).toHaveBeenCalledWith("commission-calc?merchant_id=m1&category_id=c1", { method: "GET" });
  });

  it("stores a chosen picture at once under the merchant's folder and returns its public address", async () => {
    const { supabase, upload } = fakeSupabase();
    const file = new File([new Uint8Array([1])], "front.jpg", { type: "image/jpeg" });
    const result = await createSupabaseMerchantProducts(supabase).prepareImage(ref, file);
    expect(result.ok && result.url).toMatch(/^https:\/\/storage\.test\/m1\/\d+-front\.jpg$/);
    expect(result.ok && result.file).toBeUndefined();
    expect(upload).toHaveBeenCalledTimes(1);
  });

  describe("save", () => {
    const fields = { categoryId: "c1", name: "Shoes", slug: "shoes", description: null, basePrice: 2400, status: "published" as const };
    const variant = { sku: "S", attributes: { size: "M" }, price: 2400, stock: 5, isDefault: true, lowStockThreshold: 2 };

    it("inserts the product for the shop with its variant, inventory and pictures", async () => {
      const { supabase, statements } = fakeSupabase((s) => (s.calls.some((c) => c[0] === "insert") && s.table !== "product_images" ? { data: { id: s.table === "products" ? "newp" : "newv" } } : {}));
      const result = await createSupabaseMerchantProducts(supabase).save(ref, fields, [variant], [{ url: "https://img.test/a.jpg" }, { url: "  " }]);
      expect(result).toEqual({ ok: true, productId: "newp" });
      const [product, newVariant, inventory, image] = statements;
      expect(has(product.calls, "insert", { merchant_id: "m1", store_id: "s1", category_id: "c1", name: "Shoes", slug: "shoes", description: null, base_price: 2400, status: "published" })).toBe(true);
      expect(has(newVariant.calls, "insert", { product_id: "newp", sku: "S", attributes: { size: "M" }, price: 2400, is_default: true })).toBe(true);
      expect(has(inventory.calls, "upsert", { variant_id: "newv", stock_quantity: 5, low_stock_threshold: 2 }, { onConflict: "variant_id" })).toBe(true);
      expect(has(image.calls, "insert", { product_id: "newp", url: "https://img.test/a.jpg", is_primary: true })).toBe(true);
      expect(statements).toHaveLength(4); // the blank picture is skipped
    });

    it("updates an existing product and variant, then removes pictures and variants taken out", async () => {
      const { supabase, statements } = fakeSupabase();
      const result = await createSupabaseMerchantProducts(supabase).save(ref, fields, [{ ...variant, id: "v1" }], [{ id: "i1", url: "https://img.test/b.jpg" }], "p1", { variantIds: ["v9"], imageIds: ["i9"] });
      expect(result).toEqual({ ok: true, productId: "p1" });
      expect(has(statements[0].calls, "eq", "id", "p1")).toBe(true);
      expect(has(statements[1].calls, "eq", "id", "v1")).toBe(true);
      expect(has(statements.at(-2)!.calls, "in", "id", ["i9"])).toBe(true);
      expect(has(statements.at(-1)!.calls, "in", "id", ["v9"])).toBe(true);
    });

    it("stops at the first refused write and says when a removed variant is in use", async () => {
      const refused = fakeSupabase((s) => (s.table === "products" ? { error: { message: "rejected" } } : {}));
      expect(await createSupabaseMerchantProducts(refused.supabase).save(ref, fields, [variant], [], "p1")).toEqual({ ok: false, error: "rejected" });
      expect(refused.statements).toHaveLength(1);

      const inUse = fakeSupabase((s) => (s.calls.some((c) => c[0] === "delete") && s.table === "product_variants" ? { error: { message: "fk", code: "23503" } } : {}));
      expect(await createSupabaseMerchantProducts(inUse.supabase).save(ref, fields, [], [], "p1", { variantIds: ["v9"], imageIds: [] })).toEqual({ ok: false, error: "fk", variantInUse: true });
    });
  });
});
