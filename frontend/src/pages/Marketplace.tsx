import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PackageSearch, Search, SlidersHorizontal, Store as StoreIcon } from "lucide-react";
import { Button, CUSTOMER_PAGE_SIZE, EmptyState, Input, Pagination, Sheet, SkeletonRows, totalPagesFor, usePagination, useTranslation } from "@tolo/ui";
import { supabase } from "../lib/supabase";
import { fetchMerchantRatings } from "../lib/merchantRatings";
import { ProductCard } from "../components/ProductCard";
import { CategoryTile } from "../components/CategoryTile";
import { ShopCard } from "../components/ShopCard";
import { ScrollRow } from "../components/ScrollRow";
import { RecentlyViewedRow } from "../components/RecentlyViewedRow";
import type { Category, MerchantRating, Product } from "../types";

interface Banner {
  id: string;
  image_url: string;
  link_url: string | null;
  title: string | null;
}

// merchants!inner ( is_test ) lets every query below exclude QA/CI fixture
// merchants (migration 0079) -- their products deliberately carry
// status: 'published' too, so nothing else here would tell them apart
// from a real listing. The `!inner` hint is required for the
// merchants.is_test filter below to actually exclude a matching row --
// without it, PostgREST leaves `products` as a left join and a failing
// filter just nulls the merchants embed instead (see BrowseShops.tsx).
const PRODUCT_SELECT = `
  id, merchant_id, store_id, category_id, name, slug, description, base_price, discount_price, status,
  customer_price:products_customer_price,
  product_variants ( id, sku, attributes, price, discount_price, is_default, stock_status:variant_stock_status, stock_remaining:variant_stock_remaining ),
  product_images ( id, url, is_primary, variant_id ),
  stores ( name, slug ),
  merchants!inner ( is_test )
`;

interface ShopHit {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  status: string;
  merchants: { status: string; is_test: boolean } | null;
}

// Same "open" definition BrowseShops.tsx/Storefront.tsx use, plus
// excluding a QA/CI fixture merchant the same way PRODUCT_SELECT does.
function isStoreOpen(store: ShopHit): boolean {
  return (
    store.status === "active" &&
    (store.merchants?.status === "active" || store.merchants?.status === "approved") &&
    store.merchants?.is_test !== true
  );
}

type SortOption = "newest" | "price_asc" | "price_desc" | "rating_desc";

const SORT_OPTION_VALUES: SortOption[] = ["newest", "price_asc", "price_desc", "rating_desc"];
// t()'s translation keys for each -- resolved inside the component, since
// module scope has no access to the active locale.
const SORT_OPTION_KEYS: Record<SortOption, string> = {
  newest: "marketplace.sort.newest",
  price_asc: "marketplace.sort.priceAsc",
  price_desc: "marketplace.sort.priceDesc",
  rating_desc: "marketplace.sort.ratingDesc",
};

function isSortOption(value: string | null): value is SortOption {
  return (SORT_OPTION_VALUES as string[]).includes(value ?? "");
}

export function Marketplace() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get("q") ?? "";
  const activeCategory = searchParams.get("category");
  const minPrice = searchParams.get("min_price") ?? "";
  const maxPrice = searchParams.get("max_price") ?? "";
  const sortParam = searchParams.get("sort");
  const sort: SortOption = isSortOption(sortParam) ? sortParam : "newest";

  const hasActiveFilters = Boolean(search.trim() || activeCategory || minPrice || maxPrice || sort !== "newest");

  const [categories, setCategories] = useState<Category[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [featured, setFeatured] = useState<Product[] | null>(null);
  const [shops, setShops] = useState<ShopHit[] | null>(null);
  const [shopMatches, setShopMatches] = useState<ShopHit[]>([]);
  const [ratings, setRatings] = useState<Map<string, MerchantRating>>(new Map());
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const { page, from, to, setPage } = usePagination({
    pageSize: CUSTOMER_PAGE_SIZE,
    resetKey: `${activeCategory ?? ""}:${search}:${minPrice}:${maxPrice}:${sort}`,
  });

  // All filter/sort state lives in the URL (same ?tab=/?filter= pattern
  // used elsewhere in this app) so a filtered view is shareable and
  // survives a refresh — replace: true so typing in the search/price boxes
  // doesn't flood browser history with one entry per keystroke; whatever's
  // currently in the address bar is still the accurate, shareable state.
  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  }

  useEffect(() => {
    supabase
      .from("categories")
      .select("id, name, slug, image_url")
      .eq("is_active", true)
      .order("sort_order")
      .then(({ data }) => setCategories(data ?? []));
    // Group 4, item 18. is_active is also enforced server-side (RLS,
    // migration 0068) -- filtering it here too just avoids a flash of a
    // banner an admin just deactivated before the next full reload.
    supabase
      .from("homepage_banners")
      .select("id, image_url, link_url, title")
      .eq("is_active", true)
      .order("sort_order")
      .then(({ data }) => setBanners((data as Banner[]) ?? []));
  }, []);

  // Only the true, unfiltered homepage — not every search/category view
  // that happens to share this same route/component.
  const isHomepage = !search && !activeCategory && !minPrice && !maxPrice;

  useEffect(() => {
    setLoading(true);
    let query = supabase
      .from("products")
      .select(PRODUCT_SELECT, { count: "exact" })
      .eq("status", "published")
      .eq("merchants.is_test", false);

    if (activeCategory) query = query.eq("category_id", activeCategory);
    if (search.trim()) query = query.ilike("name", `%${search.trim()}%`);
    // Filtered/ordered against the same server-computed customer_price
    // ProductCard/ProductDetail always display — never base_price, which
    // isn't what a customer actually pays.
    if (minPrice) query = query.gte("products_customer_price", Number(minPrice));
    if (maxPrice) query = query.lte("products_customer_price", Number(maxPrice));

    if (sort === "price_asc") query = query.order("products_customer_price", { ascending: true });
    else if (sort === "price_desc") query = query.order("products_customer_price", { ascending: false });
    // Ordered server-side via products_avg_rating (migration 0053) so this
    // stays correct one page at a time — an unrated product has a null
    // average, sorted last (nullsFirst: false) rather than as "0 stars".
    else if (sort === "rating_desc") query = query.order("products_avg_rating", { ascending: false, nullsFirst: false });
    else query = query.order("created_at", { ascending: false });

    query.range(from, to).then(({ data, count }) => {
      setProducts((data as unknown as Product[]) ?? []);
      setTotalCount(count ?? 0);
      setLoading(false);
    });
  }, [activeCategory, search, minPrice, maxPrice, sort, from, to]);

  // Home-mode sections (featured products, shop teaser row) only fetched
  // when browsing, not while filtering/searching — same product-status
  // rule as the main grid, just a second bounded query.
  useEffect(() => {
    if (hasActiveFilters) return;
    supabase
      .from("products")
      .select(PRODUCT_SELECT)
      .eq("status", "published")
      .eq("is_featured", true)
      .eq("merchants.is_test", false)
      .limit(10)
      .then(({ data }) => setFeatured((data as unknown as Product[]) ?? []));

    supabase
      .from("stores")
      .select("id, name, slug, logo_url, status, merchants ( status, is_test )")
      .limit(12)
      .then(({ data }) => setShops(((data as unknown as ShopHit[]) ?? []).filter(isStoreOpen)));
  }, [hasActiveFilters]);

  // Shop-name matches for the unified search box — same simple ilike
  // pattern the product search already uses, just against `stores` too.
  useEffect(() => {
    if (!search.trim()) {
      setShopMatches([]);
      return;
    }
    supabase
      .from("stores")
      .select("id, name, slug, logo_url, status, merchants ( status, is_test )")
      .ilike("name", `%${search.trim()}%`)
      .limit(6)
      .then(({ data }) => setShopMatches(((data as unknown as ShopHit[]) ?? []).filter(isStoreOpen)));
  }, [search]);

  useEffect(() => {
    const merchantIds = [...products, ...(featured ?? [])].map((p) => p.merchant_id);
    if (merchantIds.length === 0) return;
    fetchMerchantRatings(merchantIds).then((next) => setRatings((prev) => new Map([...prev, ...next])));
  }, [products, featured]);

  return (
    <div>
      {isHomepage && banners.length > 0 && (
        <div className="mb-6 -mx-1 flex gap-3 overflow-x-auto pb-1">
          {banners.map((b) => {
            const image = (
              <img src={b.image_url} alt={b.title ?? ""} className="h-32 sm:h-40 w-auto rounded-lg object-cover flex-shrink-0" />
            );
            if (!b.link_url) return <div key={b.id}>{image}</div>;
            // link_url can point at an external URL or an internal route --
            // <a> handles both, react-router's <Link> only the latter.
            return /^https?:\/\//.test(b.link_url) ? (
              <a key={b.id} href={b.link_url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
                {image}
              </a>
            ) : (
              <Link key={b.id} to={b.link_url} className="flex-shrink-0">
                {image}
              </Link>
            );
          })}
        </div>
      )}

      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500 pointer-events-none" />
          <Input
            type="search"
            placeholder={t("marketplace.searchPlaceholder")}
            value={search}
            onChange={(e) => updateParam("q", e.target.value)}
            className="pl-9"
          />
        </div>
        <Button variant="outline" onClick={() => setFilterSheetOpen(true)} className="flex-shrink-0">
          <SlidersHorizontal className="w-4 h-4" />
          <span className="hidden sm:inline">{t("marketplace.filters")}</span>
        </Button>
      </div>

      <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
        <button
          onClick={() => updateParam("category", "")}
          className={`px-3 py-1.5 rounded-full text-sm border flex-shrink-0 ${
            activeCategory === null ? "bg-navy text-white border-navy" : "bg-white dark:bg-navy-dark"
          }`}
        >
          {t("marketplace.allCategories")}
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => updateParam("category", c.id)}
            className={`px-3 py-1.5 rounded-full text-sm border flex-shrink-0 ${
              activeCategory === c.id ? "bg-navy text-white border-navy" : "bg-white dark:bg-navy-dark"
            }`}
          >
            {c.name}
          </button>
        ))}
      </div>

      {!hasActiveFilters && (
        <>
          <ScrollRow title={t("marketplace.shopByCategory")}>
            {categories.map((c) => (
              <CategoryTile key={c.id} name={c.name} imageUrl={c.image_url} onClick={() => updateParam("category", c.id)} />
            ))}
          </ScrollRow>

          {featured && featured.length > 0 && (
            <ScrollRow title={t("marketplace.featuredProducts")}>
              {featured.map((p) => (
                <ProductCard key={p.id} product={p} rating={ratings.get(p.merchant_id)} className="w-40 flex-shrink-0" />
              ))}
            </ScrollRow>
          )}

          <RecentlyViewedRow />

          {shops && shops.length > 0 && (
            <ScrollRow title={t("marketplace.discoverShops")} seeAllTo="/stores">
              {shops.map((s) => (
                <ShopCard key={s.id} slug={s.slug} name={s.name} photoUrl={s.logo_url} subtitle="" className="w-40 flex-shrink-0" />
              ))}
            </ScrollRow>
          )}

          <h2 className="font-semibold text-base mb-2">{t("marketplace.allProducts")}</h2>
        </>
      )}

      {hasActiveFilters && shopMatches.length > 0 && (
        <ScrollRow title={t("nav.shops")}>
          {shopMatches.map((s) => (
            <ShopCard key={s.id} slug={s.slug} name={s.name} photoUrl={s.logo_url} subtitle="" className="w-40 flex-shrink-0" />
          ))}
        </ScrollRow>
      )}

      {loading ? (
        <SkeletonRows count={4} />
      ) : products.length === 0 ? (
        <EmptyState
          icon={hasActiveFilters ? PackageSearch : StoreIcon}
          title={t("marketplace.noProductsTitle")}
          description={t("marketplace.noProductsDescription")}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {products.map((p) => (
              <ProductCard key={p.id} product={p} rating={ratings.get(p.merchant_id)} />
            ))}
          </div>
          <div className="mt-6">
            <Pagination page={page} totalPages={totalPagesFor(totalCount, CUSTOMER_PAGE_SIZE)} onPageChange={setPage} />
          </div>
        </>
      )}

      <Sheet
        open={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        title={t("marketplace.filtersAndSort")}
        footer={
          <Button className="w-full" onClick={() => setFilterSheetOpen(false)}>
            {t("marketplace.showResults")}
          </Button>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t("marketplace.sortBy")}</label>
            <select
              value={sort}
              onChange={(e) => updateParam("sort", e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm"
            >
              {SORT_OPTION_VALUES.map((value) => (
                <option key={value} value={value}>
                  {t(SORT_OPTION_KEYS[value])}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t("marketplace.minPrice")}</label>
              <Input type="number" min={0} placeholder="0" value={minPrice} onChange={(e) => updateParam("min_price", e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t("marketplace.maxPrice")}</label>
              <Input
                type="number"
                min={0}
                placeholder={t("marketplace.anyPrice")}
                value={maxPrice}
                onChange={(e) => updateParam("max_price", e.target.value)}
              />
            </div>
          </div>
          {(minPrice || maxPrice || sort !== "newest") && (
            <button
              onClick={() => {
                const next = new URLSearchParams(searchParams);
                next.delete("min_price");
                next.delete("max_price");
                next.delete("sort");
                setSearchParams(next, { replace: true });
              }}
              className="text-xs text-navy font-medium"
            >
              {t("marketplace.clearFilters")}
            </button>
          )}
        </div>
      </Sheet>
    </div>
  );
}
