import { type ToloClient, withQuery } from "@tolo/api-client";
import type { components } from "@tolo/api-client";
import type { Category, MerchantRating, Product, ProductImage, ProductVariant, StorefrontStore } from "../../types";
import type { CatalogueBackend, ProductListQuery, ProductSort, Shop, ShopSummary, StoreCategory, SummaryCategory } from "./types";

type Schemas = components["schemas"];
type CategoryDto = Schemas["CategoryDto"];
type ProductSummaryDto = Schemas["ProductSummaryDto"];
type ProductDto = Schemas["ProductDto"];
type VariantDto = Schemas["VariantDto"];
type PublicMerchantDto = Schemas["PublicMerchantDto"];

// Differences from the Supabase data model that the adapter absorbs (each is listed as a gap in the PR):
//  * There is no separate "store": a shop is the merchant. Shop and store ids are the merchant id.
//  * Products and shops are fetched by id, not slug, so the `slug` the screens put in URLs holds the id in this backend.
//  * The product list carries one price, one image and the rating; no variants (so no stock badge on cards) and no store name.
const LOW_STOCK = 5;

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
    slug: s.id,
    description: null,
    base_price: num(s.price) ?? 0,
    discount_price: num(s.discount_price),
    status: "published",
    customer_price: num(s.customer_price) ?? 0,
    product_variants: [],
    product_images: s.image_url ? [{ id: `${s.id}-primary`, url: s.image_url, is_primary: true, variant_id: null }] : [],
  };
}

/** Raw stock never reaches a customer: only in stock, low (with the remaining count, capped) or out. */
export function stockStatus(quantity: number): Pick<ProductVariant, "stock_status" | "stock_remaining"> {
  if (quantity <= 0) return { stock_status: "out_of_stock", stock_remaining: null };
  if (quantity <= LOW_STOCK) return { stock_status: "low", stock_remaining: quantity };
  return { stock_status: "in_stock", stock_remaining: null };
}

function mapVariant(v: VariantDto): ProductVariant {
  return {
    id: v.id,
    sku: v.sku ?? null,
    attributes: (v.attributes ?? {}) as Record<string, string>,
    price: Number(v.price),
    discount_price: num(v.discount_price),
    is_default: v.is_default,
    customer_price: Number(v.customer_price),
    ...stockStatus(Number(v.stock_quantity)),
  };
}

export function mapProductDetail(p: ProductDto, merchant: PublicMerchantDto | null): Product {
  const base = mapProductSummary(p.summary);
  const images: ProductImage[] = p.images.map((i) => ({ id: i.id, url: i.url, is_primary: i.is_primary, variant_id: null, sort_order: Number(i.sort_order) }));
  return {
    ...base,
    description: p.description ?? null,
    product_variants: p.variants.map(mapVariant),
    product_images: images,
    stores: merchant ? { name: merchant.business_name, slug: merchant.id, logo_url: merchant.logo_url ?? null } : null,
    merchants: merchant ? { avg_rating: num(merchant.average_rating), review_count: Number(merchant.review_count) } : null,
  };
}

function mapShop(m: PublicMerchantDto): Shop {
  return { id: m.id, merchant_id: m.id, name: m.business_name, slug: m.id, logo_url: m.logo_url ?? null };
}

export function mapStorefront(m: PublicMerchantDto): StorefrontStore {
  return {
    id: m.id,
    merchant_id: m.id,
    name: m.business_name,
    slug: m.id,
    description: m.description ?? null,
    logo_url: m.logo_url ?? null,
    banner_url: m.banner_url ?? null,
    // The public endpoint only returns merchants a customer may see, so what comes back is open for business.
    status: "active",
    // Not in the public merchant: the hours text is empty and "open now" comes from the server.
    operating_hours: {},
    is_open_now: m.open_now,
    prep_time_minutes: null,
    merchants: { status: "active", avg_rating: num(m.average_rating), review_count: Number(m.review_count) },
  };
}

const SORTS: Record<ProductSort, string | undefined> = { newest: "newest", price_asc: "price_asc", price_desc: "price_desc", rating_desc: "rating" };

/** The new C# API, behind the same interface. */
export function createApiCatalogue(client: ToloClient): CatalogueBackend {
  const ratings = new Map<string, MerchantRating>();
  const merchants = new Map<string, Promise<PublicMerchantDto | null>>();

  async function fetchMerchant(id: string): Promise<PublicMerchantDto | null> {
    const { data, response } = await client.GET("/api/customer/merchants/{id}", { params: { path: { id } } });
    if (data) return data;
    if (response.status !== 404 && response.status !== 400) console.error(`GET merchant ${id} failed: ${response.status}`);
    return null;
  }

  // One request per distinct merchant for the whole session, however many cards ask.
  const merchant = (id: string) => {
    let cached = merchants.get(id);
    if (!cached) {
      cached = fetchMerchant(id);
      merchants.set(id, cached);
    }
    return cached;
  };

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
    const { data, response } = await client.GET(
      "/api/customer/products",
      withQuery({
        q: q.search?.trim(),
        category_id: q.categoryId,
        merchant_id: q.storeId,
        min_price: q.minPrice,
        max_price: q.maxPrice,
        featured: q.featured ? true : undefined,
        sort,
        page: q.page,
        page_size: q.pageSize,
      }),
    );
    if (!data) {
      console.error(`GET products failed: ${response.status}`);
      return { items: [], total: 0 };
    }
    return { items: data.items.map(mapProductSummary), total: Number(data.total) };
  }

  async function fetchProduct(id: string, withMerchant: boolean): Promise<Product | null> {
    const { data, response } = await client.GET("/api/customer/products/{id}", { params: { path: { id } } });
    if (!data) {
      if (response.status !== 404 && response.status !== 400) console.error(`GET product ${id} failed: ${response.status}`);
      return null;
    }
    return mapProductDetail(data, withMerchant ? await merchant(data.summary.merchant_id) : null);
  }

  return {
    listCategories: fetchCategories,
    listProducts: fetchProducts,
    getProduct: (id) => fetchProduct(id, true),

    // No batch lookup in the API: one request per id (recently viewed keeps this list short).
    async getProductsByIds(ids) {
      const found = await Promise.all(ids.map((id) => fetchProduct(id, false)));
      return found.filter((p): p is Product => p !== null);
    },

    async listShops({ page, pageSize, search }) {
      const { data, response } = await client.GET("/api/customer/merchants", withQuery({ q: search?.trim(), page, page_size: pageSize }));
      if (!data) {
        console.error(`GET merchants failed: ${response.status}`);
        return { items: [], total: 0 };
      }
      for (const m of data.items) {
        merchants.set(m.id, Promise.resolve(m));
        ratings.set(m.id, { avg_rating: num(m.average_rating), review_count: Number(m.review_count) });
      }
      return { items: data.items.map(mapShop), total: Number(data.total) };
    },

    async getStorefront(id) {
      const m = await merchant(id);
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

    // No batch endpoint: one product request per shop on the page (a shop's newest 20 products), plus the category list once.
    async getShopSummaries(shops: Shop[]) {
      const map = new Map<string, ShopSummary>();
      if (shops.length === 0) return map;
      const categories = new Map((await fetchCategories()).map((c) => [c.id, c]));
      await Promise.all(
        shops.map(async (shop) => {
          const { items } = await fetchProducts({ page: 1, pageSize: 20, storeId: shop.id, sort: "newest" });
          const summary: ShopSummary = { categories: [], productNames: [], latestProductImage: null };
          for (const p of items) {
            const c = p.category_id ? categories.get(p.category_id) : undefined;
            if (c && !summary.categories.some((x) => x.name === c.name)) {
              summary.categories.push({ name: c.name, name_am: c.name_am, icon: c.icon, color: c.color } satisfies SummaryCategory);
            }
            summary.productNames.push(p.name);
          }
          const first = items.find((p) => p.product_images.length > 0);
          if (first) summary.latestProductImage = { url: first.product_images[0].url, createdAt: "" };
          map.set(shop.id, summary);
        }),
      );
      return map;
    },

    // No batch endpoint: one merchant request per distinct merchant, remembered for the session (listing shops fills the cache for free).
    async getMerchantRatings(merchantIds) {
      const result = new Map<string, MerchantRating>();
      await Promise.all(
        [...new Set(merchantIds)].map(async (id) => {
          let rating = ratings.get(id);
          if (!rating) {
            const m = await merchant(id);
            if (m) {
              rating = { avg_rating: num(m.average_rating), review_count: Number(m.review_count) };
              ratings.set(id, rating);
            }
          }
          if (rating) result.set(id, rating);
        }),
      );
      return result;
    },
  };
}
