import { merchantProducts } from "../data/merchantProducts";
import type { ImageInput, ProductInput as ProductFields, SaveProductResult, VariantInput } from "../data/merchantProducts";

// Writing a product is the merchant-products adapter's job (src/data/merchantProducts): Supabase today, the C# API behind VITE_BACKEND_MERCHANT_PRODUCTS.
// The pure rules (isEligibleForListing, slugify, parseAttributes, etc.) live in productRules.ts, not here.

export type { ImageInput, SaveProductResult, VariantInput };

export interface ProductInput extends ProductFields {
  merchantId: string;
  storeId: string;
}

// Inserts or updates a product plus its variants and pictures. The CSV import (BulkUpload.tsx) calls it; the single-product editor uses the adapter directly.
export function saveProduct(productInput: ProductInput, variants: VariantInput[], images: ImageInput[], existingProductId?: string): Promise<SaveProductResult> {
  const { merchantId, storeId, ...product } = productInput;
  return merchantProducts.save({ merchantId, storeId }, product, variants, images, existingProductId);
}
