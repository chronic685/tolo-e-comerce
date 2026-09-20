import { afterEach, describe, expect, inject, it } from "vitest";
import { serviceClient } from "../env.ts";

// Phase 5d, item 7: a return never restocked inventory even once the item
// was physically back with the merchant — return_status already had
// 'received' and inventory_movements already had 'restock' as enum values,
// neither ever used. migration 0037's trigger on returns fires on the exact
// same plain `.update()` the admin Refunds.tsx page does (setReturnStatus),
// mirroring migration 0034's refund wallet-clawback trigger pattern.
const db = serviceClient();

async function variantIdForProduct(productId: string): Promise<string> {
  const { data, error } = await db.from("product_variants").select("id").eq("product_id", productId).single();
  if (error) throw error;
  return data.id as string;
}

async function stockOf(variantId: string): Promise<number> {
  const { data, error } = await db.from("inventory").select("stock_quantity").eq("variant_id", variantId).single();
  if (error) throw error;
  return data.stock_quantity as number;
}

async function restockMovements(variantId: string, referenceId: string) {
  const { data, error } = await db
    .from("inventory_movements")
    .select("quantity, reference_type")
    .eq("variant_id", variantId)
    .eq("movement_type", "restock")
    .eq("reference_id", referenceId);
  if (error) throw error;
  return data;
}

describe("returns: restocking inventory when the item is marked received", () => {
  // reviewableMerchantOrderId carries exactly one unit each of
  // reviewableProductAId/B (see ensureQaFixtures) — restocking both in one
  // return exercises the trigger's per-order-item loop, not just a single row.
  let variantAId: string;
  let variantBId: string;
  const createdReturnIds: string[] = [];

  afterEach(async () => {
    // Undo whatever stock this test's returns added, so the shared fixture
    // variants aren't left permanently inflated for every other test file.
    // A plain decrement, not release_stock() — that RPC also touches
    // reserved_quantity, which this restock path never reserved against.
    for (const id of createdReturnIds.splice(0)) {
      const { data: movements } = await db.from("inventory_movements").select("variant_id, quantity").eq("reference_type", "return").eq("reference_id", id);
      for (const m of movements ?? []) {
        const current = await stockOf(m.variant_id);
        await db.from("inventory").update({ stock_quantity: current - m.quantity }).eq("variant_id", m.variant_id);
      }
    }
  });

  it("restocks every order_item on the order once an approved return is marked received", async () => {
    const fixtures = inject("qaFixtures");
    variantAId = await variantIdForProduct(fixtures.reviewableProductAId);
    variantBId = await variantIdForProduct(fixtures.reviewableProductBId);

    const stockABefore = await stockOf(variantAId);
    const stockBBefore = await stockOf(variantBId);

    const { data: returnRow, error: returnError } = await db
      .from("returns")
      .insert({
        merchant_order_id: fixtures.reviewableMerchantOrderId,
        customer_id: fixtures.customerUserId,
        reason: "QA TEST — Phase 5d restock",
        status: "approved",
      })
      .select("id")
      .single();
    expect(returnError).toBeNull();
    createdReturnIds.push(returnRow!.id);

    // Approving alone must not restock — only physical receipt does.
    expect(await stockOf(variantAId)).toBe(stockABefore);
    expect(await stockOf(variantBId)).toBe(stockBBefore);

    const { error: receiveError } = await db.from("returns").update({ status: "received" }).eq("id", returnRow!.id);
    expect(receiveError).toBeNull();

    expect(await stockOf(variantAId)).toBe(stockABefore + 1);
    expect(await stockOf(variantBId)).toBe(stockBBefore + 1);

    const movementsA = await restockMovements(variantAId, returnRow!.id);
    expect(movementsA).toHaveLength(1);
    expect(movementsA[0].quantity).toBe(1);
    expect(movementsA[0].reference_type).toBe("return");

    const movementsB = await restockMovements(variantBId, returnRow!.id);
    expect(movementsB).toHaveLength(1);
  });

  it("does not restock a second time if the received row is updated again", async () => {
    const fixtures = inject("qaFixtures");
    const variantId = await variantIdForProduct(fixtures.reviewableProductAId);

    const { data: returnRow, error } = await db
      .from("returns")
      .insert({
        merchant_order_id: fixtures.reviewableMerchantOrderId,
        customer_id: fixtures.customerUserId,
        reason: "QA TEST — Phase 5d restock double-fire guard",
        status: "received",
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    createdReturnIds.push(returnRow!.id);

    const stockAfterFirstReceive = await stockOf(variantId);

    // Touching the row again while status stays "received" must not re-fire.
    const { error: touchError } = await db.from("returns").update({ reason: "QA TEST — Phase 5d restock double-fire guard (edited)" }).eq("id", returnRow!.id);
    expect(touchError).toBeNull();

    expect(await stockOf(variantId)).toBe(stockAfterFirstReceive);

    const movements = await restockMovements(variantId, returnRow!.id);
    expect(movements).toHaveLength(1);
  });

  it("a return inserted as already-'received' restocks too (not just the approved-→received path)", async () => {
    const fixtures = inject("qaFixtures");
    const variantId = await variantIdForProduct(fixtures.reviewableProductAId);
    const stockBefore = await stockOf(variantId);

    const { data: returnRow, error } = await db
      .from("returns")
      .insert({
        merchant_order_id: fixtures.reviewableMerchantOrderId,
        customer_id: fixtures.customerUserId,
        reason: "QA TEST — Phase 5d restock direct-insert",
        status: "received",
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    createdReturnIds.push(returnRow!.id);

    expect(await stockOf(variantId)).toBe(stockBefore + 1);
  });
});
