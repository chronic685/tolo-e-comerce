import type { SupabaseClient } from "@supabase/supabase-js";
import { PRODUCT_IMAGE_PRESET, compressImage } from "@tolo/ui";
import type { Category, Product } from "../../types";
import type {
  ImageInput,
  LoadedProduct,
  MerchantProductsBackend,
  ProductInput,
  ProductTab,
  Removals,
  SaveProductResult,
  ShopRef,
  VariantInput,
} from "./types";

// The queries and writes below are the ones the screens ran before the adapter existed, moved here unchanged.

const PRODUCT_SELECT = `
  id, merchant_id, store_id, category_id, name, slug, description, base_price, discount_price, status, archived_at, archived_by_role,
  product_variants ( id, product_id, sku, attributes, price, discount_price, is_default, inventory ( stock_quantity, reserved_quantity, available_quantity ) ),
  product_images ( id, url, is_primary ),
  categories ( name, name_am )
`;

const FORM_SELECT = `name, description, category_id, base_price, status, archived_by_role,
         product_variants ( id, sku, attributes, price, inventory ( stock_quantity, low_stock_threshold ) ),
         product_images ( id, url )`;

export function createSupabaseMerchantProducts(supabase: SupabaseClient): MerchantProductsBackend {
  /** The active tab hides archived products; the archived tab shows only those. */
  function tabQuery(ref: ShopRef, tab: ProductTab, count: boolean) {
    const base = supabase.from("products").select(PRODUCT_SELECT, count ? { count: "exact" } : undefined).eq("merchant_id", ref.merchantId);
    return (tab === "archived" ? base.eq("status", "archived") : base.neq("status", "archived")).order("created_at", { ascending: false });
  }

  return {
    async list(ref, tab, page, pageSize) {
      const from = (page - 1) * pageSize;
      const { data, count } = await tabQuery(ref, tab, true).range(from, from + pageSize - 1);
      return { items: (data as unknown as Product[]) ?? [], total: count ?? 0 };
    },

    async listAll(ref, tab) {
      // One response is capped at 1,000 rows, so read the whole list a page at a time.
      const rows: Product[] = [];
      for (let from = 0; ; from += 1000) {
        const { data } = await tabQuery(ref, tab, false).range(from, from + 999);
        const page = (data as unknown as Product[]) ?? [];
        rows.push(...page);
        if (page.length < 1000) return rows;
      }
    },

    async setVisible(ids, visible) {
      const { error } = await supabase.from("products").update({ status: visible ? "published" : "paused" }).in("id", ids);
      return error ? { ok: false, error: error.message } : { ok: true };
    },

    async archive(ids) {
      const { data, error } = await supabase.rpc("archive_products", { p_ids: ids });
      return error ? { ok: false, error: error.message } : { ok: true, count: Number(data ?? ids.length) };
    },

    async restore(ids) {
      const { data, error } = await supabase.rpc("restore_products", { p_ids: ids }).single();
      if (error) return { ok: false, error: error.message };
      const result = data as { restored: number; blocked: number };
      return { ok: true, restored: result.restored, blocked: result.blocked };
    },

    // A product any order has referenced has to stay in the records, so the merchant is offered "Archive instead" rather than a delete that would fail.
    async hasOrders(id) {
      const { data, error } = await supabase.rpc("product_has_orders", { p_product_id: id });
      return error ? { ok: false, error: error.message } : { ok: true, hasOrders: Boolean(data) };
    },

    async remove(id) {
      const { error } = await supabase.from("products").delete().eq("id", id);
      return error ? { ok: false, error: error.message } : { ok: true };
    },

    async load(id): Promise<LoadedProduct | null> {
      const { data } = await supabase.from("products").select(FORM_SELECT).eq("id", id).maybeSingle();
      if (!data) return null;
      const variants =
        (data.product_variants as unknown as {
          id: string;
          sku: string | null;
          attributes: Record<string, string> | null;
          price: number;
          inventory: { stock_quantity: number; low_stock_threshold: number } | null;
        }[]) ?? [];
      return {
        name: data.name,
        description: data.description ?? null,
        categoryId: data.category_id ?? null,
        basePrice: Number(data.base_price),
        status: data.status as string,
        archivedBy: (data.archived_by_role as "merchant" | "staff" | null) ?? null,
        variants: variants.map((v) => ({
          id: v.id,
          sku: v.sku,
          attributes: v.attributes ?? {},
          price: Number(v.price),
          stock: v.inventory?.stock_quantity ?? 0,
          lowStockThreshold: v.inventory?.low_stock_threshold ?? 5,
        })),
        images: ((data.product_images as unknown as { id: string; url: string }[]) ?? []).map((i) => ({ id: i.id, url: i.url })),
      };
    },

    async categories(): Promise<Category[]> {
      const { data } = await supabase.from("categories").select("id, name, name_am, slug").eq("is_active", true);
      return (data as Category[] | null) ?? [];
    },

    async commissionRate(ref, categoryId) {
      const params = new URLSearchParams({ merchant_id: ref.merchantId });
      if (categoryId) params.set("category_id", categoryId);
      const { data } = await supabase.functions.invoke(`commission-calc?${params.toString()}`, { method: "GET" });
      return data?.rate_percent ?? null;
    },

    async prepareImage(ref, file) {
      let prepared: File;
      try {
        prepared = await compressImage(file, PRODUCT_IMAGE_PRESET);
      } catch {
        return { ok: false, error: "", prepareFailed: true };
      }

      const path = `${ref.merchantId}/${Date.now()}-${prepared.name}`;
      const { error } = await supabase.storage.from("product-images").upload(path, prepared);
      if (error) return { ok: false, error: error.message };
      return { ok: true, url: supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl };
    },

    // Inserts or updates a product plus its variants/inventory/images. This is the one place that knows how to write a product to these four tables:
    // the single-product editor and the CSV import both come through here.
    async save(ref, product, variants, images, existingProductId, removals): Promise<SaveProductResult> {
      const productPayload = {
        merchant_id: ref.merchantId,
        store_id: ref.storeId,
        category_id: product.categoryId,
        name: product.name,
        slug: product.slug,
        description: product.description,
        base_price: product.basePrice,
        status: product.status,
      };

      let productId = existingProductId;
      if (!productId) {
        const { data, error } = await supabase.from("products").insert(productPayload).select("id").single();
        if (error) return { ok: false, error: error.message };
        productId = data.id as string;
      } else {
        const { error } = await supabase.from("products").update(productPayload).eq("id", productId);
        if (error) return { ok: false, error: error.message };
      }

      // These writes can genuinely fail now that migration 0041's listing-eligibility trigger is real: a stale/incorrect price+stock combo gets rejected here.
      for (const v of variants) {
        const variantPayload = { product_id: productId, sku: v.sku, attributes: v.attributes, price: v.price, is_default: v.isDefault };
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
          const inventoryPayload: Record<string, unknown> = { variant_id: variantId, stock_quantity: v.stock };
          if (v.lowStockThreshold !== undefined) inventoryPayload.low_stock_threshold = v.lowStockThreshold;
          const { error } = await supabase.from("inventory").upsert(inventoryPayload, { onConflict: "variant_id" });
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

      // Removals go after the save so the product is never left without a variant. A variant customers have ordered cannot be deleted
      // (order_items keeps it), so that is reported rather than hidden.
      if (removals && removals.imageIds.length > 0) {
        await supabase.from("product_images").delete().in("id", removals.imageIds);
      }
      if (removals && removals.variantIds.length > 0) {
        const { error } = await supabase.from("product_variants").delete().in("id", removals.variantIds);
        if (error) return { ok: false, error: error.message, variantInUse: error.code === "23503" };
      }

      return { ok: true, productId: productId! };
    },
  };
}

export type { ImageInput, ProductInput, Removals, VariantInput };
