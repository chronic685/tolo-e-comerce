// Group 4, item 13. Pure predicate so "is this item still orderable"
// isn't only ever exercised inside OrderDetail.tsx's handleReorder().
export interface VariantAvailability {
  stock_status: string;
  products: { status: string } | null;
}

export function isVariantReorderable(v: VariantAvailability | undefined): boolean {
  return v?.products?.status === "published" && v.stock_status !== "out_of_stock";
}
