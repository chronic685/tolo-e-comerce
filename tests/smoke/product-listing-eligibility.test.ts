import { afterEach, describe, expect, inject, it } from "vitest";
import { serviceClient } from "../env.ts";

// A product can only be published/submitted if stock >= 2 OR price >= 1000
// ETB for every one of its variants (migration 0041). Enforced as a real
// database trigger (not just the merchant-dashboard's client-side check in
// ProductForm.tsx) so a direct API call can't bypass it. Draft is exempt —
// merchants must be able to build a listing before it's ready.
const db = serviceClient();

interface DisposableProduct {
  productId: string;
  variantId: string;
  storeId: string;
}

async function createDisposableProduct(
  merchantId: string,
  storeId: string,
  price: number,
  stock: number,
  status: "draft" | "published" = "draft",
): Promise<DisposableProduct> {
  const { data: product, error: productError } = await db
    .from("products")
    .insert({
      merchant_id: merchantId,
      store_id: storeId,
      name: "QA TEST — Phase 6 listing eligibility",
      slug: `qa-test-listing-eligibility-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      base_price: price,
      status: "draft",
    })
    .select("id")
    .single();
  if (productError) throw productError;

  const { data: variant, error: variantError } = await db
    .from("product_variants")
    .insert({ product_id: product.id, sku: null, attributes: {}, price, is_default: true })
    .select("id")
    .single();
  if (variantError) throw variantError;

  const { error: inventoryError } = await db.from("inventory").upsert({ variant_id: variant.id, stock_quantity: stock });
  if (inventoryError) throw inventoryError;

  if (status === "published") {
    const { error: publishError } = await db.from("products").update({ status: "published" }).eq("id", product.id);
    if (publishError) throw publishError;
  }

  return { productId: product.id, variantId: variant.id, storeId };
}

describe("product listing eligibility: stock >= 2 OR price >= 1000", () => {
  const createdProductIds: string[] = [];

  afterEach(async () => {
    for (const id of createdProductIds.splice(0)) {
      await db.from("products").delete().eq("id", id);
    }
  });

  it("draft products are exempt — a non-compliant draft saves fine", async () => {
    const fixtures = inject("qaFixtures");
    const { data: store } = await db.from("stores").select("id").eq("merchant_id", fixtures.merchantAId).single();
    const { productId } = await createDisposableProduct(fixtures.merchantAId, store!.id, 200, 1, "draft");
    createdProductIds.push(productId);

    const { data } = await db.from("products").select("status").eq("id", productId).single();
    expect(data!.status).toBe("draft");
  });

  it("blocks publishing when price < 1000 and stock < 2", async () => {
    const fixtures = inject("qaFixtures");
    const { data: store } = await db.from("stores").select("id").eq("merchant_id", fixtures.merchantAId).single();
    const { productId } = await createDisposableProduct(fixtures.merchantAId, store!.id, 200, 1, "draft");
    createdProductIds.push(productId);

    const { error } = await db.from("products").update({ status: "published" }).eq("id", productId);
    expect(error).not.toBeNull();
    expect(error!.message).toContain("2+ units in stock or a price of at least 1000 ETB");

    const { data } = await db.from("products").select("status").eq("id", productId).single();
    expect(data!.status).toBe("draft");
  });

  it("allows publishing when price >= 1000, regardless of stock", async () => {
    const fixtures = inject("qaFixtures");
    const { data: store } = await db.from("stores").select("id").eq("merchant_id", fixtures.merchantAId).single();
    const { productId } = await createDisposableProduct(fixtures.merchantAId, store!.id, 1200, 0, "draft");
    createdProductIds.push(productId);

    const { error } = await db.from("products").update({ status: "published" }).eq("id", productId);
    expect(error).toBeNull();
  });

  it("allows publishing when stock >= 2, regardless of price", async () => {
    const fixtures = inject("qaFixtures");
    const { data: store } = await db.from("stores").select("id").eq("merchant_id", fixtures.merchantAId).single();
    const { productId } = await createDisposableProduct(fixtures.merchantAId, store!.id, 50, 5, "draft");
    createdProductIds.push(productId);

    const { error } = await db.from("products").update({ status: "published" }).eq("id", productId);
    expect(error).toBeNull();
  });

  it("blocks publishing a product with no variants at all", async () => {
    const fixtures = inject("qaFixtures");
    const { data: store } = await db.from("stores").select("id").eq("merchant_id", fixtures.merchantAId).single();
    const { data: product, error: productError } = await db
      .from("products")
      .insert({
        merchant_id: fixtures.merchantAId,
        store_id: store!.id,
        name: "QA TEST — Phase 6 no-variant product",
        slug: `qa-test-no-variant-${Date.now()}`,
        base_price: 1500,
        status: "draft",
      })
      .select("id")
      .single();
    expect(productError).toBeNull();
    createdProductIds.push(product!.id);

    const { error } = await db.from("products").update({ status: "published" }).eq("id", product!.id);
    expect(error).not.toBeNull();
  });

  it("blocks dropping price below the threshold on an already-published, stock-side-borderline product", async () => {
    const fixtures = inject("qaFixtures");
    const { data: store } = await db.from("stores").select("id").eq("merchant_id", fixtures.merchantAId).single();
    // Compliant via price alone (1200 >= 1000) with only 1 unit in stock.
    const { productId, variantId } = await createDisposableProduct(fixtures.merchantAId, store!.id, 1200, 1, "published");
    createdProductIds.push(productId);

    const { error } = await db.from("product_variants").update({ price: 200 }).eq("id", variantId);
    expect(error).not.toBeNull();
    expect(error!.message).toContain("2+ units in stock or a price of at least 1000 ETB");

    const { data } = await db.from("product_variants").select("price").eq("id", variantId).single();
    expect(Number(data!.price)).toBe(1200);
  });

  it("blocks dropping stock below the threshold on an already-published, price-side-borderline product", async () => {
    const fixtures = inject("qaFixtures");
    const { data: store } = await db.from("stores").select("id").eq("merchant_id", fixtures.merchantAId).single();
    // Compliant via stock alone (5 >= 2) at a low price.
    const { productId, variantId } = await createDisposableProduct(fixtures.merchantAId, store!.id, 200, 5, "published");
    createdProductIds.push(productId);

    const { error } = await db.from("inventory").update({ stock_quantity: 1 }).eq("variant_id", variantId);
    expect(error).not.toBeNull();

    const { data } = await db.from("inventory").select("stock_quantity").eq("variant_id", variantId).single();
    expect(data!.stock_quantity).toBe(5);
  });

  it("a no-op resave (same price, same status) never re-fires the check, even for a product only borderline-compliant", async () => {
    const fixtures = inject("qaFixtures");
    const { data: store } = await db.from("stores").select("id").eq("merchant_id", fixtures.merchantAId).single();
    const { productId, variantId } = await createDisposableProduct(fixtures.merchantAId, store!.id, 1000, 0, "published");
    createdProductIds.push(productId);

    // Re-sending the exact same values (as ProductForm.tsx's save flow
    // always does, whether or not the merchant actually touched that field)
    // must not re-trigger the check — only an ACTUAL change does.
    const { error: variantError } = await db.from("product_variants").update({ price: 1000 }).eq("id", variantId);
    expect(variantError).toBeNull();

    const { error: statusError } = await db.from("products").update({ status: "published" }).eq("id", productId);
    expect(statusError).toBeNull();
  });

  it("release_stock's sale-completion path is never blocked, even when it drops a low-priced product below the stock threshold", async () => {
    const fixtures = inject("qaFixtures");
    const { data: store } = await db.from("stores").select("id").eq("merchant_id", fixtures.merchantAId).single();
    // Compliant via stock (5 >= 2) at a low price — published successfully.
    const { productId, variantId } = await createDisposableProduct(fixtures.merchantAId, store!.id, 200, 5, "published");
    createdProductIds.push(productId);

    const referenceId = crypto.randomUUID();
    const { error: reserveError } = await db.rpc("reserve_stock", { p_variant_id: variantId, p_quantity: 5, p_reference_id: referenceId });
    expect(reserveError).toBeNull();

    // Selling all 5 units leaves stock at 0 with a 200 ETB price — well
    // below the threshold — but this is a real sale completing, not a
    // merchant choosing to list/delist anything, so it must succeed.
    const { error: releaseError } = await db.rpc("release_stock", {
      p_variant_id: variantId,
      p_quantity: 5,
      p_reference_id: referenceId,
      p_as_sale: true,
    });
    expect(releaseError).toBeNull();

    const { data: product } = await db.from("products").select("status").eq("id", productId).single();
    expect(product!.status).toBe("published"); // not silently unpublished either

    const { data: inventory } = await db.from("inventory").select("stock_quantity").eq("variant_id", variantId).single();
    expect(inventory!.stock_quantity).toBe(0);
  });

  it("restocking from a return is never blocked, even when the product remains below the threshold afterward", async () => {
    const fixtures = inject("qaFixtures");
    const { data: store } = await db.from("stores").select("id").eq("merchant_id", fixtures.merchantAId).single();
    // Published while compliant via stock (2 >= 2), then legitimately
    // depleted to 0 by a real sale (release_stock, bypass-flag-protected) —
    // this is the only way to reach "published, price=200, stock=0"
    // without the trigger itself (correctly) rejecting the setup.
    const { productId, variantId } = await createDisposableProduct(fixtures.merchantAId, store!.id, 200, 2, "published");
    createdProductIds.push(productId);
    const depleteReferenceId = crypto.randomUUID();
    await db.rpc("reserve_stock", { p_variant_id: variantId, p_quantity: 2, p_reference_id: depleteReferenceId });
    await db.rpc("release_stock", { p_variant_id: variantId, p_quantity: 2, p_reference_id: depleteReferenceId, p_as_sale: true });

    // Build a disposable order/return referencing this variant directly
    // (not via checkout — this test targets the restock trigger's
    // interaction with the new listing check specifically, not checkout).
    const { data: order, error: orderError } = await db
      .from("orders")
      .insert({ customer_id: fixtures.customerUserId, address_id: fixtures.addressId })
      .select("id")
      .single();
    expect(orderError).toBeNull();

    const { data: merchantOrder, error: moError } = await db
      .from("merchant_orders")
      .insert({ order_id: order!.id, merchant_id: fixtures.merchantAId, status: "completed" })
      .select("id")
      .single();
    expect(moError).toBeNull();

    const { error: itemError } = await db.from("order_items").insert({
      merchant_order_id: merchantOrder!.id,
      variant_id: variantId,
      product_name_snapshot: "QA TEST — Phase 6 listing eligibility",
      unit_price: 200,
      quantity: 1,
      subtotal: 200,
    });
    expect(itemError).toBeNull();

    const { data: returnRow, error: returnError } = await db
      .from("returns")
      .insert({
        merchant_order_id: merchantOrder!.id,
        customer_id: fixtures.customerUserId,
        reason: "QA TEST — Phase 6 listing eligibility restock",
        status: "approved",
      })
      .select("id")
      .single();
    expect(returnError).toBeNull();

    // Restocking 1 unit brings stock from 0 to 1 -- still under the
    // threshold (price is 200) -- but the restock itself must still succeed.
    const { error: receiveError } = await db.from("returns").update({ status: "received" }).eq("id", returnRow!.id);
    expect(receiveError).toBeNull();

    const { data: inventory } = await db.from("inventory").select("stock_quantity").eq("variant_id", variantId).single();
    expect(inventory!.stock_quantity).toBe(1);
  });
});
