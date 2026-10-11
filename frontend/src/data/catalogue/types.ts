import type { Category, MerchantRating, Product, StorefrontStore } from "../../types";

export type ProductSort = "newest" | "price_asc" | "price_desc" | "rating_desc";

export interface ProductListQuery {
  /** 1-based. */
  page: number;
  pageSize: number;
  categoryId?: string | null;
  /** A store (shop) page: only this store's products. */
  storeId?: string;
  search?: string;
  /** Both in what the customer pays, never the merchant's own price. */
  minPrice?: number;
  maxPrice?: number;
  sort?: ProductSort;
  featured?: boolean;
}

export interface ProductPage {
  items: Product[];
  total: number;
}

/** A shop as the listing screens need it. Only shops a customer may see are returned (open, not a test fixture). */
export interface Shop {
  id: string;
  merchant_id: string;
  name: string;
  slug: string;
  logo_url: string | null;
}

export interface ShopListQuery {
  page: number;
  pageSize: number;
  search?: string;
}

export interface ShopPage {
  items: Shop[];
  total: number;
}

export interface StoreCategory {
  id: string;
  name: string;
  name_am: string | null;
  icon: string;
  color: string;
}

export interface SummaryCategory {
  name: string;
  name_am: string | null;
  icon: string;
  color: string;
}

export interface ShopSummary {
  categories: SummaryCategory[];
  productNames: string[];
  /** The shop's most-recently-added product image, used as the card photo when the shop has no logo. */
  latestProductImage: { url: string; createdAt: string } | null;
}

/**
 * What the customer catalogue screens need (categories, shops, products, search, price filters). Two implementations: Supabase (today's
 * queries, unchanged) and the C# API. Screens import `catalogue` from ./index and never know which one answers.
 */
export interface CatalogueBackend {
  listCategories(): Promise<Category[]>;
  listProducts(query: ProductListQuery): Promise<ProductPage>;
  /** One published product by the identifier used in its URL (the slug; the API backend uses the id). null when there is none. */
  getProduct(slugOrId: string): Promise<Product | null>;
  /** Published products for these ids, in the order given (recently viewed). Missing ones are left out. */
  getProductsByIds(ids: string[]): Promise<Product[]>;
  listShops(query: ShopListQuery): Promise<ShopPage>;
  /** A shop page by the identifier used in its URL (the slug; the API backend uses the id). null when there is none. */
  getStorefront(slugOrId: string): Promise<StorefrontStore | null>;
  /** The categories a shop's published products are in (the filter pills). */
  listStoreCategories(store: StorefrontStore): Promise<StoreCategory[]>;
  /** Category names, a few product names and a photo per shop, for the shop cards. Keyed by shop id. */
  getShopSummaries(shops: Shop[]): Promise<Map<string, ShopSummary>>;
  getMerchantRatings(merchantIds: string[]): Promise<Map<string, MerchantRating>>;
}
