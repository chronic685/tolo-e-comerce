import type { components } from "@tolo/api-client";
import type { ToloClient } from "@tolo/api-client";
import type { OperatingHours } from "@tolo/ui";
import type { Category, MerchantRating, Product, ProductImage, ProductVariant, StorefrontStore } from "../../types";
import type { CatalogueBackend, ProductListQuery, ProductSort, Shop, ShopSummary, StoreCategory } from "./types";

type Schemas = components["schemas"];
type CategoryDto = Schemas["CategoryDto"];
type ProductSummaryDto = Schemas["ProductSummaryDto"];
type PublicProductDto = Schemas["PublicProductDto"];
type PublicVariantDto = Schemas["PublicVariantDto"];
type PublicMerchantDto = Schemas["PublicMerchantDto"];

// Differences from the Supabase data model that the adapter absorbs (what is still missing from the API is listed in docs/api-migration.md):
//  * There is no separate "store": a shop is the merchant, so store_id and merchant_id are the same value.
//  * Products and shops are found by slug or id (the API takes either), so `slug` is the real slug in this backend too.
//  * The API gives no stock counts: a variant is in stock or not, plus the most one order may take (max_order_quantity).

/** The API takes at most this many ids in one `ids=` request. */
export const MAX_IDS = 50;

const num = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));

export function mapCategory(c: CategoryDto): Category {
  return { id: c.id, name: c.name, name_am: c.name_am ?? null, slug: c.slug, icon: c.icon, color: c.color };
}

export function mapProductSummary(s: ProductSummaryDto): Product {
  return {
    id: s.id,
    merchant_id: s.merchant_id,
    store_id: s.merchant_id,
    category_id: s.category_id ?? null,
    name: s.name,
    slug: s.slug,
    description: null,
    base_price: num(s.price) ?? 0,
    discount_price: num(s.discount_price),
    status: "published",
    customer_price: num(s.customer_price) ?? 0,
    in_stock: s.in_stock,
    product_variants: [],
    product_images: s.image_url ? [{ id: `${s.id}-primary`, url: s.image_url, is_primary: true, variant_id: null }] : [],
    stores: s.merchant_name && s.merchant_slug ? { name: s.merchant_name, slug: s.merchant_slug } : null,
  };
}

function mapVariant(v: PublicVariantDto): ProductVariant {
  return {
    id: v.id,
    sku: v.sku ?? null,
    attributes: (v.attributes ?? {}) as Record<string, string>,
    price: Number(v.price),
    discount_price: num(v.discount_price),
    is_default: v.is_default,
    customer_price: Number(v.customer_price),
    stock_status: v.in_stock ? "in_stock" : "out_of_stock",
    stock_remaining: null,
    max_order_quantity: Number(v.max_order_quantity),
  };
}

export function mapProductDetail(p: PublicProductDto, merchant: PublicMerchantDto | null): Product {
  const base = mapProductSummary(p.summary);
  const images: ProductImage[] = p.images.map((i) => ({ id: i.id, url: i.url, is_primary: i.is_primary, variant_id: null, sort_order: Number(i.sort_order) }));
  return {
    ...base,
    description: p.description ?? null,
    product_variants: p.variants.map(mapVariant),
    product_images: images,
    stores: merchant ? { name: merchant.business_name, slug: merchant.slug, logo_url: merchant.logo_url ?? null } : base.stores,
    merchants: merchant ? { avg_rating: num(merchant.average_rating), review_count: Number(merchant.review_count) } : null,
  };
}

function mapShop(m: PublicMerchantDto): Shop {
  return { id: m.id, merchant_id: m.id, name: m.business_name, slug: m.slug, logo_url: m.logo_url ?? null };
}

export function mapShopSummary(m: PublicMerchantDto): ShopSummary {
  return {
    categories: (m.categories ?? []).map((c) => ({ name: c.name, name_am: c.name_am ?? null, icon: c.icon, color: c.color })),
    productNames: m.sample_product_names ?? [],
    latestProductImage: m.latest_product_image_url ? { url: m.latest_product_image_url, createdAt: "" } : null,
  };
}

export function mapStorefront(m: PublicMerchantDto): StorefrontStore {
  return {
    id: m.id,
    merchant_id: m.id,
    name: m.business_name,
    slug: m.slug,
    description: m.description ?? null,
    logo_url: m.logo_url ?? null,
    banner_url: m.banner_url ?? null,
    // The public endpoint only returns merchants a customer may see, so what comes back is open for business.
    status: "active",
    // null when the shop has set no hours: the same as the empty object the screens already understand.
    operating_hours: (m.weekly_hours ?? {}) as OperatingHours,
    is_open_now: m.open_now,
    prep_time_minutes: num(m.prep_time_minutes),
    merchants: { status: "active", avg_rating: num(m.average_rating), review_count: Number(m.review_count) },
  };
}

const SORTS: Record<ProductSort, "newest" | "price_asc" | "price_desc" | "rating"> = { newest: "newest", price_asc: "price_asc", price_desc: "price_desc", rating_desc: "rating" };

// ids=a,b,c rather than ids=a&ids=b (the API documents the comma form).
const COMMA_LISTS = { array: { style: "form", explode: false } } as const;

/** The new C# API, behind the same interface. */
export function createApiCatalogue(client: ToloClient): CatalogueBackend {
  const merchants = new Map<string, PublicMerchantDto>(); // by id and by slug

  function remember(m: PublicMerchantDto) {
    merchants.set(m.id, m);
    merchants.set(m.slug, m);
  }

  async function fetchMerchant(idOrSlug: string): Promise<PublicMerchantDto | null> {
    const cached = merchants.get(idOrSlug);
    if (cached) return cached;
    const { data, response } = await client.GET("/api/customer/merchants/{id}", { params: { path: { id: idOrSlug } } });
    if (data) {
      remember(data);
      return data;
    }
    if (response.status !== 404 && response.status !== 400) console.error(`GET merchant ${idOrSlug} failed: ${response.status}`);
    return null;
  }

  /** Several shops in one request (at most MAX_IDS each), remembered for the session. Shops that are not public are simply not returned. */
  async function fetchMerchants(ids: string[]): Promise<PublicMerchantDto[]> {
    const unique = [...new Set(ids)];
    const missing = unique.filter((id) => !merchants.has(id));
    for (let i = 0; i < missing.length; i += MAX_IDS) {
      const chunk = missing.slice(i, i + MAX_IDS);
      const { data, response } = await client.GET("/api/customer/merchants", { params: { query: { ids: chunk, page_size: chunk.length } }, querySerializer: COMMA_LISTS });
      if (!data) {
        console.error(`GET merchants failed: ${response.status}`);
        continue;
      }
      data.items.forEach(remember);
    }
    return unique.map((id) => merchants.get(id)).filter((m): m is PublicMerchantDto => m !== undefined);
  }

  async function fetchCategories(): Promise<Category[]> {
    const { data, response } = await client.GET("/api/customer/categories");
    if (!data) {
      console.error(`GET categories failed: ${response.status}`);
      return [];
    }
    return data.map(mapCategory);
  }

  async function fetchProducts(q: ProductListQuery) {
    // Searching with the screen's default order (newest) means "best match first": leave the sort to the API, whose default for a search is relevance.
    const sort = q.search?.trim() && (q.sort ?? "newest") === "newest" ? undefined : SORTS[q.sort ?? "newest"];
    const { data, response } = await client.GET("/api/customer/products", {
      params: {
        query: {
          q: q.search?.trim() || undefined,
          category_id: q.categoryId ?? undefined,
          merchant_id: q.storeId,
          min_price: q.minPrice,
          max_price: q.maxPrice,
          featured: q.featured ? true : undefined,
          sort,
          page: q.page,
          page_size: q.pageSize,
        },
      },
    });
    if (!data) {
      console.error(`GET products failed: ${response.status}`);
      return { items: [], total: 0 };
    }
    return { items: data.items.map(mapProductSummary), total: Number(data.total) };
  }

  return {
    listCategories: fetchCategories,
    listProducts: fetchProducts,

    async getProduct(idOrSlug) {
      const { data, response } = await client.GET("/api/customer/products/{id}", { params: { path: { id: idOrSlug } } });
      if (!data) {
        if (response.status !== 404 && response.status !== 400) console.error(`GET product ${idOrSlug} failed: ${response.status}`);
        return null;
      }
      return mapProductDetail(data, await fetchMerchant(data.summary.merchant_id));
    },

    // One request for up to 50 ids, in the order asked; products that are gone are simply not returned.
    async getProductsByIds(ids) {
      const found = new Map<string, Product>();
      const unique = [...new Set(ids)];
      for (let i = 0; i < unique.length; i += MAX_IDS) {
        const chunk = unique.slice(i, i + MAX_IDS);
        const { data, response } = await client.GET("/api/customer/products", { params: { query: { ids: chunk, page_size: chunk.length } }, querySerializer: COMMA_LISTS });
        if (!data) {
          console.error(`GET products failed: ${response.status}`);
          continue;
        }
        for (const s of data.items) found.set(s.id, mapProductSummary(s));
      }
      return ids.map((id) => found.get(id)).filter((p): p is Product => p !== undefined);
    },

    async listShops({ page, pageSize, search }) {
      // Browsing is by name, as before; a search ranks by relevance.
      const q = search?.trim() || undefined;
      const { data, response } = await client.GET("/api/customer/merchants", { params: { query: { q, sort: q ? undefined : "name", page, page_size: pageSize } } });
      if (!data) {
        console.error(`GET merchants failed: ${response.status}`);
        return { items: [], total: 0 };
      }
      data.items.forEach(remember);
      return { items: data.items.map(mapShop), total: Number(data.total) };
    },

    async getStorefront(idOrSlug) {
      const m = await fetchMerchant(idOrSlug);
      return m ? mapStorefront(m) : null;
    },

    // No per-shop category endpoint: the categories of the shop's first 100 products, named from the category list.
    async listStoreCategories(store: StorefrontStore): Promise<StoreCategory[]> {
      const [{ items }, categories] = await Promise.all([fetchProducts({ page: 1, pageSize: 100, storeId: store.id }), fetchCategories()]);
      const used = new Set(items.map((p) => p.category_id).filter((id): id is string => id !== null));
      return categories
        .filter((c) => used.has(c.id))
        .map((c) => ({ id: c.id, name: c.name, name_am: c.name_am, icon: c.icon, color: c.color }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    // The shop list already carries each shop's categories, sample product names and latest picture.
    async getShopSummaries(shops: Shop[]) {
      const map = new Map<string, ShopSummary>();
      for (const m of await fetchMerchants(shops.map((s) => s.id))) map.set(m.id, mapShopSummary(m));
      return map;
    },

    async getMerchantRatings(merchantIds) {
      const result = new Map<string, MerchantRating>();
      for (const m of await fetchMerchants(merchantIds)) result.set(m.id, { avg_rating: num(m.average_rating), review_count: Number(m.review_count) });
      return result;
    },
  };
}
