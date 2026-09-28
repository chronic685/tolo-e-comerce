import { describe, expect, it } from "vitest";
import { isVariantReorderable } from "../../frontend/src/lib/reorder";

describe("isVariantReorderable (Group 4, item 13)", () => {
  it("is reorderable when published and not out of stock", () => {
    expect(isVariantReorderable({ stock_status: "in_stock", products: { status: "published" } })).toBe(true);
    expect(isVariantReorderable({ stock_status: "low", products: { status: "published" } })).toBe(true);
  });

  it("is not reorderable when out of stock", () => {
    expect(isVariantReorderable({ stock_status: "out_of_stock", products: { status: "published" } })).toBe(false);
  });

  it("is not reorderable when the product is no longer published", () => {
    expect(isVariantReorderable({ stock_status: "in_stock", products: { status: "draft" } })).toBe(false);
    expect(isVariantReorderable({ stock_status: "in_stock", products: { status: "archived" } })).toBe(false);
  });

  it("is not reorderable when the variant/product no longer exists at all", () => {
    expect(isVariantReorderable(undefined)).toBe(false);
    expect(isVariantReorderable({ stock_status: "in_stock", products: null })).toBe(false);
  });
});
