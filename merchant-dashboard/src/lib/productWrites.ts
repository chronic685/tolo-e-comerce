import { supabase } from "./supabase";

// The pure rules (isEligibleForListing, slugify, parseAttributes, etc.) live
// in productRules.ts, not here — that file has no Supabase import, so it
// stays importable from a plain unit test without needing a real client.
// Callers needing both should import from each module directly rather than
// through a re-export here.

export interface VariantInput {
  id?: string;
  sku: string | null;
  attributes: Record<string, string>;
  price: number;
  stock: number;
  isDefault: boolean;
}

export interface ImageInput {
  id?: string;
  url: string;
}

export interface ProductInput {
  merchantId: string;
  storeId: string;
  categoryId: string | null;
  name: string;
  slug: string;
  description: string | null;
  basePrice: number;
  status: "draft" | "published" | "submitted";
}

export type SaveProductResult = { ok: true; productId: string } | { ok: false; error: string };

// Inserts or updates a product plus its variants/inventory/images. This is
// the one place that knows how to write a product to these four tables —
// both ProductForm.tsx (the single-product editor) and BulkUpload.tsx (CSV
// import) call it rather than each reimplementing the same sequence of
// table writes.
export async function saveProduct(
  productInput: ProductInput,
  variants: VariantInput[],
  images: ImageInput[],
  existingProductId?: string,
): Promise<SaveProductResult> {
  const productPayload = {
    merchant_id: productInput.merchantId,
    store_id: productInput.storeId,
    category_id: productInput.categoryId,
    name: productInput.name,
    slug: productInput.slug,
    description: productInput.description,
    base_price: productInput.basePrice,
    status: productInput.status,
  };

  let productId = existingProductId;
  if (!productId) {
    const { data, error } = await supabase.from("products").insert(productPayload).select("id").single();
    if (error) return { ok: false, error: error.message };
    productId = data.id;
  } else {
    const { error } = await supabase.from("products").update(productPayload).eq("id", productId);
    if (error) return { ok: false, error: error.message };
  }

  // These writes can genuinely fail now that migration 0041's listing-
  // eligibility trigger is real — a stale/incorrect price+stock combo gets
  // rejected here, not silently dropped.
  for (const v of variants) {
    const variantPayload = {
      product_id: productId,
      sku: v.sku,
      attributes: v.attributes,
      price: v.price,
      is_default: v.isDefault,
    };
    let variantId = v.id;
    if (variantId) {
      const { error } = await supabase.from("product_variants").update(variantPayload).eq("id", variantId);
      if (error) return { ok: false, error: error.message };
    } else {
      const { data, error } = await supabase.from("product_variants").insert(variantPayload).select("id").single();
      if (error) return { ok: false, error: error.message };
      variantId = data?.id;
    }
    if (variantId) {
      const { error } = await supabase
        .from("inventory")
        .upsert({ variant_id: variantId, stock_quantity: v.stock }, { onConflict: "variant_id" });
      if (error) return { ok: false, error: error.message };
    }
  }

  for (const img of images) {
    if (!img.url.trim()) continue;
    if (img.id) {
      await supabase.from("product_images").update({ url: img.url }).eq("id", img.id);
    } else {
      await supabase.from("product_images").insert({ product_id: productId, url: img.url, is_primary: images.indexOf(img) === 0 });
    }
  }

  return { ok: true, productId: productId! };
}
