import type { SupabaseClient } from "@supabase/supabase-js";
import type { Category, MerchantRating, Product, StorefrontStore } from "../../types";
import type { CatalogueBackend, ProductListQuery, Shop, ShopSummary, StoreCategory, SummaryCategory } from "./types";

// The queries below are the ones the screens ran before the adapter existed, moved here unchanged.
//
// merchants!inner ( is_test ) lets every product query exclude QA/CI fixture merchants (migration 0079) -- their products deliberately carry
// status: 'published' too, so nothing else would tell them apart from a real listing. The `!inner` hint is required for the
// merchants.is_test filter to actually exclude a matching row; without it PostgREST leaves `products` as a left join and a failing filter just
// nulls the merchants embed instead.
const GRID_SELECT = `
  id, merchant_id, store_id, category_id, name, slug, description, base_price, discount_price, status,
  customer_price:products_customer_price,
  product_variants ( id, sku, attributes, price, discount_price, is_default, stock_status:variant_stock_status, stock_remaining:variant_stock_remaining ),
  product_images ( id, url, is_primary, variant_id ),
  stores ( name, slug ),
  merchants!inner ( is_test )
`;

const STORE_GRID_SELECT = `
  id, merchant_id, store_id, category_id, name, slug, description, base_price, discount_price, status,
  customer_price:products_customer_price,
  product_variants ( id, sku, attributes, price, discount_price, is_default, stock_status:variant_stock_status, stock_remaining:variant_stock_remaining ),
  product_images ( id, url, is_primary, variant_id ),
  stores ( name, slug ),
  categories ( name )
`;

// merchants(...) is only fetched for a single product, not on grid pages: one merchant's rating once, instead of the same aggregate per card.
const DETAIL_SELECT = `
  id, merchant_id, store_id, category_id, name, slug, description, base_price, discount_price, status,
  product_variants ( id, sku, attributes, price, discount_price, is_default, customer_price:product_variants_customer_price,
    stock_status:variant_stock_status, stock_remaining:variant_stock_remaining ),
  product_images ( id, url, is_primary, variant_id, sort_order ),
  stores ( name, slug, logo_url ),
  merchants!inner ( is_test, avg_rating:merchants_avg_rating, review_count:merchants_review_count )
`;

const SHOP_SELECT = "id, name, slug, logo_url, status, merchant_id, merchants!inner ( status, is_test )";

interface ShopRow {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  status: string;
  merchant_id: string;
  merchants: { status: string; is_test: boolean } | null;
}

function toShop(row: ShopRow): Shop {
  return { id: row.id, merchant_id: row.merchant_id, name: row.name, slug: row.slug, logo_url: row.logo_url };
}

/** Today's behaviour: the same Supabase queries the screens ran directly. */
export function createSupabaseCatalogue(supabase: SupabaseClient): CatalogueBackend {
  return {
    async listCategories(): Promise<Category[]> {
      const { data } = await supabase.from("categories").select("id, name, name_am, slug, icon, color").eq("is_active", true).order("sort_order");
      return (data as Category[] | null) ?? [];
    },

    async listProducts(q: ProductListQuery) {
      const from = (q.page - 1) * q.pageSize;
      const to = from + q.pageSize - 1;
      let query = q.storeId
        ? supabase.from("products").select(STORE_GRID_SELECT, { count: "exact" }).eq("store_id", q.storeId).eq("status", "published")
        : supabase.from("products").select(GRID_SELECT, { count: "exact" }).eq("status", "published").eq("merchants.is_test", false);

      if (q.categoryId) query = query.eq("category_id", q.categoryId);
      if (q.featured) query = query.eq("is_featured", true);
      if (q.search?.trim()) query = query.ilike("name", `%${q.search.trim()}%`);
      // Filtered and ordered against the same server-computed customer_price the cards display -- never base_price.
      if (q.minPrice != null) query = query.gte("products_customer_price", q.minPrice);
      if (q.maxPrice != null) query = query.lte("products_customer_price", q.maxPrice);

      if (q.sort === "price_asc") query = query.order("products_customer_price", { ascending: true });
      else if (q.sort === "price_desc") query = query.order("products_customer_price", { ascending: false });
      // Ordered server-side via products_avg_rating (migration 0053): an unrated product has a null average and sorts last, not as "0 stars".
      else if (q.sort === "rating_desc") query = query.order("products_avg_rating", { ascending: false, nullsFirst: false });
      else query = query.order("created_at", { ascending: false });

      const { data, count } = await query.range(from, to);
      return { items: (data as unknown as Product[]) ?? [], total: count ?? 0 };
    },

    async getProduct(slug: string) {
      const { data } = await supabase
        .from("products")
        .select(DETAIL_SELECT)
        .eq("slug", slug)
        .eq("status", "published")
        .eq("merchants.is_test", false)
        .maybeSingle();
      return (data as unknown as Product | null) ?? null;
    },

    async getProductsByIds(ids: string[]) {
      if (ids.length === 0) return [];
      const { data } = await supabase.from("products").select(GRID_SELECT).in("id", ids).eq("status", "published").eq("merchants.is_test", false);
      const byId = new Map(((data as unknown as Product[]) ?? []).map((p) => [p.id, p]));
      // `.in()` does not preserve the id list's order.
      return ids.map((id) => byId.get(id)).filter((p): p is Product => p !== undefined);
    },

    async listShops({ page, pageSize, search }) {
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      // "Open" = the store is active AND its merchant account is active/approved AND the merchant is not a test fixture. Pushed into the query
      // (with the required `!inner` hint) so the range and count describe the real, filtered page.
      let query = supabase
        .from("stores")
        .select(SHOP_SELECT, { count: "exact" })
        .eq("status", "active")
        .in("merchants.status", ["active", "approved"])
        .eq("merchants.is_test", false);
      if (search?.trim()) query = query.ilike("name", `%${search.trim()}%`);
      const { data, count } = await query.order("name").range(from, to);
      return { items: ((data as unknown as ShopRow[]) ?? []).map(toShop), total: count ?? 0 };
    },

    async getStorefront(slug: string) {
      const { data } = await supabase
        .from("stores")
        .select(
          "id, merchant_id, name, slug, description, logo_url, banner_url, status, operating_hours, prep_time_minutes, " +
            "is_open_now:store_is_open_now, " +
            "merchants!inner ( status, is_test, avg_rating:merchants_avg_rating, review_count:merchants_review_count )",
        )
        .eq("slug", slug)
        .eq("merchants.is_test", false)
        .maybeSingle();
      return (data as unknown as StorefrontStore | null) ?? null;
    },

    async listStoreCategories(store: StorefrontStore): Promise<StoreCategory[]> {
      const { data } = await supabase
        .from("products")
        .select("category_id, categories ( name, name_am, icon, color )")
        .eq("store_id", store.id)
        .eq("status", "published");
      const rows = (data as unknown as { category_id: string | null; categories: Omit<StoreCategory, "id"> | null }[]) ?? [];
      const seen = new Map<string, StoreCategory>();
      for (const row of rows) {
        if (row.category_id && row.categories?.name) seen.set(row.category_id, { id: row.category_id, ...row.categories });
      }
      return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
    },

    async getShopSummaries(shops: Shop[]) {
      const map = new Map<string, ShopSummary>();
      if (shops.length === 0) return map;
      // One query for every shop's products rather than N+1 per card.
      const { data } = await supabase
        .from("products")
        .select("store_id, name, created_at, categories ( name, name_am, icon, color ), product_images ( url, is_primary )")
        .eq("status", "published")
        .in(
          "store_id",
          shops.map((s) => s.id),
        );
      const rows =
        (data as unknown as {
          store_id: string;
          name: string;
          created_at: string;
          categories: SummaryCategory | null;
          product_images: { url: string; is_primary: boolean }[];
        }[]) ?? [];
      for (const row of rows) {
        const entry = map.get(row.store_id) ?? { categories: [], productNames: [], latestProductImage: null };
        if (row.categories?.name && !entry.categories.some((c) => c.name === row.categories!.name)) entry.categories.push(row.categories);
        entry.productNames.push(row.name);

        const image = row.product_images.find((i) => i.is_primary) ?? row.product_images[0];
        if (image && (!entry.latestProductImage || row.created_at > entry.latestProductImage.createdAt)) {
          entry.latestProductImage = { url: image.url, createdAt: row.created_at };
        }

        map.set(row.store_id, entry);
      }
      return map;
    },

    async getMerchantRatings(merchantIds: string[]) {
      // One batched query for every distinct merchant on a page -- never once per card.
      const uniqueIds = [...new Set(merchantIds)];
      const ratings = new Map<string, MerchantRating>();
      if (uniqueIds.length === 0) return ratings;
      const { data } = await supabase.from("merchants").select("id, avg_rating:merchants_avg_rating, review_count:merchants_review_count").in("id", uniqueIds);
      for (const row of data ?? []) ratings.set(row.id, { avg_rating: row.avg_rating, review_count: row.review_count ?? 0 });
      return ratings;
    },
  };
}
