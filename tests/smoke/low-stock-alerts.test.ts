import { afterEach, beforeAll, describe, expect, inject, it } from "vitest";
import { serviceClient } from "../env.ts";

// Group 2, item 8 (migration 0060). inventory.low_stock_threshold
// (migration 0005) already existed per variant but was never read by
// anything. notify_low_stock() fires only on the transition across the
// threshold (edge-triggered), not on every update while already low.
const db = serviceClient();

describe("low-stock alerts (inventory.low_stock_threshold, migration 0060)", () => {
  let variantId: string;
  let merchantOwnerId: string;
  let originalStock: number;
  let originalThreshold: number;

  beforeAll(async () => {
    const fixtures = inject("qaFixtures");
    variantId = fixtures.variantId;

    const { data: variant } = await db.from("product_variants").select("products ( merchant_id )").eq("id", variantId).single();
    const merchantId = (variant as unknown as { products: { merchant_id: string } }).products.merchant_id;
    const { data: merchant } = await db.from("merchants").select("owner_id").eq("id", merchantId).single();
    merchantOwnerId = merchant!.owner_id;

    const { data: inv } = await db.from("inventory").select("stock_quantity, low_stock_threshold").eq("variant_id", variantId).single();
    originalStock = inv!.stock_quantity;
    originalThreshold = inv!.low_stock_threshold;
  });

  afterEach(async () => {
    await db.from("inventory").update({ stock_quantity: originalStock, low_stock_threshold: originalThreshold }).eq("variant_id", variantId);
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
