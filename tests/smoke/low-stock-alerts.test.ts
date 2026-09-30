import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { serviceClient } from "../env.ts";

// Group 2, item 8 (migration 0060). inventory.low_stock_threshold
// (migration 0005) already existed per variant but was never read by
// anything. notify_low_stock() fires only on the transition across the
// threshold (edge-triggered), not on every update while already low.
const db = serviceClient();

describe("low-stock alerts (inventory.low_stock_threshold, migration 0060)", () => {
  let variantId: string;
  let productId: string;
  let merchantOwnerId: string;

  // A dedicated product/variant, not the shared qaFixtures.variantId --
  // that one is used across many other test files, and inventory's
  // `reserved_not_over_stock` check (stock_quantity >= reserved_quantity,
  // migration 0005) means any of those files' real orders reserving stock
  // against it could silently fail this file's own small stock_quantity
  // writes (2/3/4) once accumulated reservations exceed them. The updates
  // below don't check for an error either -- same trap that made
  // checkout's missing cart_items column invisible (see
  // 0069_fix_cart_items_missing_on_unavailable_column.sql) -- so a
  // constraint violation here would silently look identical to "the
  // trigger didn't fire" instead of failing loudly.
  beforeAll(async () => {
    const fixtures = inject("qaFixtures");
    const { data: store } = await db.from("stores").select("id").eq("merchant_id", fixtures.merchantAId).single();

    const { data: product, error: productError } = await db
      .from("products")
      .insert({
        merchant_id: fixtures.merchantAId,
        store_id: store!.id,
        name: "QA TEST — low-stock-alerts product",
        slug: `qa-test-low-stock-alerts-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        base_price: 100,
        status: "draft",
      })
      .select("id")
      .single();
    if (productError) throw productError;
    productId = product!.id;

    const { data: variant, error: variantError } = await db
      .from("product_variants")
      .insert({ product_id: productId, price: 100, is_default: true })
      .select("id")
      .single();
    if (variantError) throw variantError;
    variantId = variant!.id;

    await db.from("inventory").insert({ variant_id: variantId, stock_quantity: 100, low_stock_threshold: 5 });

    merchantOwnerId = fixtures.merchantAUserId;
  });

  afterAll(async () => {
    // inventory cascades on product_variants delete (migration 0005),
    // and product_variants cascades on products delete (migration 0004).
    if (productId) await db.from("products").delete().eq("id", productId);
  });

  async function latestLowStockNotification() {
    const { data } = await db
      .from("notifications")
      .select("body, created_at")
      .eq("user_id", merchantOwnerId)
      .eq("type", "low_stock")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data;
  }

  it("notifies the merchant when stock crosses down through the threshold", async () => {
    // Above threshold first, so the next update is a real crossing.
    await db.from("inventory").update({ stock_quantity: 100, low_stock_threshold: 5 }).eq("variant_id", variantId);
    const before = await latestLowStockNotification();

    await db.from("inventory").update({ stock_quantity: 3 }).eq("variant_id", variantId);

    const after = await latestLowStockNotification();
    expect(after).not.toBeNull();
    expect(after!.created_at).not.toBe(before?.created_at);
    expect(after!.body).toContain("3");
    expect(after!.body).not.toContain("{{");
  });

  it("does not re-notify on a further update while already below threshold", async () => {
    await db.from("inventory").update({ stock_quantity: 100, low_stock_threshold: 5 }).eq("variant_id", variantId);
    await db.from("inventory").update({ stock_quantity: 3 }).eq("variant_id", variantId);
    const firstAlert = await latestLowStockNotification();

    // Still below threshold (3 -> 2) -- must not fire a second alert.
    await db.from("inventory").update({ stock_quantity: 2 }).eq("variant_id", variantId);
    const secondCheck = await latestLowStockNotification();

    expect(secondCheck!.created_at).toBe(firstAlert!.created_at);
  });

  it("does not notify when restocking back above the threshold", async () => {
    await db.from("inventory").update({ stock_quantity: 3, low_stock_threshold: 5 }).eq("variant_id", variantId);
    const before = await latestLowStockNotification();

    await db.from("inventory").update({ stock_quantity: 100 }).eq("variant_id", variantId);

    const after = await latestLowStockNotification();
    expect(after?.created_at).toBe(before?.created_at);
  });

  it("fires again the next time stock crosses down after having recovered above threshold", async () => {
    await db.from("inventory").update({ stock_quantity: 100, low_stock_threshold: 5 }).eq("variant_id", variantId);
    await db.from("inventory").update({ stock_quantity: 3 }).eq("variant_id", variantId);
    const firstAlert = await latestLowStockNotification();

    await db.from("inventory").update({ stock_quantity: 100 }).eq("variant_id", variantId);
    await db.from("inventory").update({ stock_quantity: 4 }).eq("variant_id", variantId);

    const secondAlert = await latestLowStockNotification();
    expect(secondAlert!.created_at).not.toBe(firstAlert!.created_at);
  });
});
