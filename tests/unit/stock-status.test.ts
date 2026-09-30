import { afterEach, beforeAll, describe, expect, inject, it } from "vitest";
import { env, serviceClient } from "../env.ts";

// variant_stock_status / variant_stock_remaining (migration 0054) --
// customer-facing product availability. Customers cannot read
// `inventory` directly (RLS, migration 0014); these are PostgREST
// computed columns on product_variants that expose only a derived
// status/small integer instead. Every fixture product is created with
// status='draft' so the listing-eligibility triggers (migration 0041),
// which only fire on a transition into published/submitted, never engage
// here -- this test is about the read side, not listing eligibility.
const db = serviceClient();

interface StockRow {
  status: string;
  remaining: number | null;
}

async function fetchStatus(variantId: string): Promise<StockRow> {
  const { data, error } = await db
    .from("product_variants")
    .select("status:variant_stock_status, remaining:variant_stock_remaining")
    .eq("id", variantId)
    .single();
  if (error) throw error;
  return data as unknown as StockRow;
}

async function createVariant(
  merchantId: string,
  storeId: string,
  stockQuantity: number,
  reservedQuantity = 0,
  productStatus: "draft" | "published" = "draft",
) {
  const { data: product, error: productError } = await db
    .from("products")
    .insert({
      merchant_id: merchantId,
      store_id: storeId,
      name: "QA TEST — Phase (pagination/availability) stock status product",
      slug: `qa-test-stock-status-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      base_price: 100,
      status: productStatus,
    })
    .select("id")
    .single();
  if (productError) throw productError;

  const { data: variant, error: variantError } = await db
    .from("product_variants")
    .insert({ product_id: product!.id, price: 100, is_default: true })
    .select("id")
    .single();
  if (variantError) throw variantError;

  const { error: inventoryError } = await db
    .from("inventory")
    .insert({ variant_id: variant!.id, stock_quantity: stockQuantity, reserved_quantity: reservedQuantity });
  if (inventoryError) throw inventoryError;

  return { productId: product!.id as string, variantId: variant!.id as string };
}

describe("variant_stock_status / variant_stock_remaining", () => {
  let merchantAId: string;
  let storeId: string;
  const createdProductIds: string[] = [];

  beforeAll(async () => {
    const fixtures = inject("qaFixtures");
    merchantAId = fixtures.merchantAId;
    const { data: store } = await db.from("stores").select("id").eq("merchant_id", merchantAId).single();
    storeId = store!.id;
  });

  afterEach(async () => {
    // `inventory` cascades on product_variants delete (migration 0005: FK
    // on delete cascade), and product_variants cascades on products
    // delete (migration 0004) -- deleting the product is enough.
    for (const id of createdProductIds.splice(0)) {
      await db.from("products").delete().eq("id", id);
    }
  });

  it("reports in_stock with no remaining count for plenty of stock", async () => {
    const { productId, variantId } = await createVariant(merchantAId, storeId, 20);
    createdProductIds.push(productId);
    const row = await fetchStatus(variantId);
    expect(row.status).toBe("in_stock");
    expect(row.remaining).toBeNull();
  });

  it("reports low with the exact remaining count at the 5-units boundary", async () => {
    const { productId, variantId } = await createVariant(merchantAId, storeId, 5);
    createdProductIds.push(productId);
    const row = await fetchStatus(variantId);
    expect(row.status).toBe("low");
    expect(row.remaining).toBe(5);
  });

  it("reports low with the exact remaining count for a handful of units", async () => {
    const { productId, variantId } = await createVariant(merchantAId, storeId, 3);
    createdProductIds.push(productId);
    const row = await fetchStatus(variantId);
    expect(row.status).toBe("low");
    expect(row.remaining).toBe(3);
  });

  it("reports out_of_stock with no remaining count when stock is exhausted", async () => {
    const { productId, variantId } = await createVariant(merchantAId, storeId, 0);
    createdProductIds.push(productId);
    const row = await fetchStatus(variantId);
    expect(row.status).toBe("out_of_stock");
    expect(row.remaining).toBeNull();
  });

  it("reports out_of_stock once reservations consume the last unit", async () => {
    const { productId, variantId } = await createVariant(merchantAId, storeId, 5, 5);
    createdProductIds.push(productId);
    const row = await fetchStatus(variantId);
    expect(row.status).toBe("out_of_stock");
    expect(row.remaining).toBeNull();
  });

  it("is readable by an anonymous (unauthenticated) caller, needed for public product browsing", async () => {
    // Unlike every other fixture in this file, this one must actually be
    // published -- product_variants_select's RLS (migration 0051) only
    // grants anon/public read access when the parent product is
    // published (or the caller is the owning merchant/an admin), so a
    // 'draft' fixture is invisible to a true anonymous caller by design
    // and would make this specific assertion untestable.
    const { productId, variantId } = await createVariant(merchantAId, storeId, 3, 0, "published");
    createdProductIds.push(productId);

    const res = await fetch(
      `${env.supabaseUrl}/rest/v1/product_variants?id=eq.${variantId}&select=status:variant_stock_status,remaining:variant_stock_remaining`,
      { headers: { apikey: env.anonKey } },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json[0].status).toBe("low");
    expect(json[0].remaining).toBe(3);
  });

  it("never lets an anonymous caller read the underlying inventory table directly", async () => {
    const { productId, variantId } = await createVariant(merchantAId, storeId, 3);
    createdProductIds.push(productId);

    // The row genuinely exists (service role can see it) -- RLS must be
    // what's hiding it from anon, not the row's absence.
    const { data: viaService } = await db.from("inventory").select("variant_id").eq("variant_id", variantId).maybeSingle();
    expect(viaService).not.toBeNull();

    const res = await fetch(`${env.supabaseUrl}/rest/v1/inventory?variant_id=eq.${variantId}`, {
      headers: { apikey: env.anonKey },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual([]);
  });
});
