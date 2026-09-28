import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PackageSearch, Search, SlidersHorizontal, Store as StoreIcon } from "lucide-react";
import { Button, EmptyState, Input, Sheet, SkeletonRows } from "@tolo/ui";
import { supabase } from "../lib/supabase";
import { fetchMerchantRatings } from "../lib/merchantRatings";
import { ProductCard } from "../components/ProductCard";
import { CategoryTile } from "../components/CategoryTile";
import { ShopCard } from "../components/ShopCard";
import { ScrollRow } from "../components/ScrollRow";
import type { Category, MerchantRating, Product } from "../types";

const PRODUCT_SELECT = `
  id, merchant_id, store_id, category_id, name, slug, description, base_price, discount_price, status,
  customer_price:products_customer_price,
  product_variants ( id, sku, attributes, price, discount_price, is_default ),
  product_images ( id, url, is_primary, variant_id ),
  stores ( name, slug ),
  reviews ( rating )
`;

interface ShopHit {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  status: string;
  merchants: { status: string } | null;
}

// Same "open" definition BrowseShops.tsx/Storefront.tsx use.
function isStoreOpen(store: ShopHit): boolean {
  return store.status === "active" && (store.merchants?.status === "active" || store.merchants?.status === "approved");
}

type SortOption = "newest" | "price_asc" | "price_desc" | "rating_desc";

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "rating_desc", label: "Highest rated" },
];

function isSortOption(value: string | null): value is SortOption {
  return SORT_OPTIONS.some((o) => o.value === value);
}

function averageRating(p: Product): number {
  const reviews = p.reviews ?? [];
  // No reviews sorts last, not first, under "highest rated" — an unrated
  // product isn't "0 stars", it's just unknown.
  return reviews.length ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length : -1;
}

export function Marketplace() {
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get("q") ?? "";
  const activeCategory = searchParams.get("category");
  const minPrice = searchParams.get("min_price") ?? "";
  const maxPrice = searchParams.get("max_price") ?? "";
  const sortParam = searchParams.get("sort");
  const sort: SortOption = isSortOption(sortParam) ? sortParam : "newest";

  const hasActiveFilters = Boolean(search.trim() || activeCategory || minPrice || maxPrice || sort !== "newest");

  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [featured, setFeatured] = useState<Product[] | null>(null);
  const [shops, setShops] = useState<ShopHit[] | null>(null);
  const [shopMatches, setShopMatches] = useState<ShopHit[]>([]);
  const [ratings, setRatings] = useState<Map<string, MerchantRating>>(new Map());
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

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
  }, []);

  useEffect(() => {
    setLoading(true);
    let query = supabase.from("products").select(PRODUCT_SELECT).eq("status", "published");

    if (activeCategory) query = query.eq("category_id", activeCategory);
    if (search.trim()) query = query.ilike("name", `%${search.trim()}%`);
    // Filtered/ordered against the same server-computed customer_price
    // ProductCard/ProductDetail always display — never base_price, which
    // isn't what a customer actually pays.
    if (minPrice) query = query.gte("products_customer_price", Number(minPrice));
    if (maxPrice) query = query.lte("products_customer_price", Number(maxPrice));

    if (sort === "price_asc") query = query.order("products_customer_price", { ascending: true });
    else if (sort === "price_desc") query = query.order("products_customer_price", { ascending: false });
    else query = query.order("created_at", { ascending: false });

    query.then(({ data }) => {
      let rows = (data as unknown as Product[]) ?? [];
      if (sort === "rating_desc") {
        rows = [...rows].sort((a, b) => averageRating(b) - averageRating(a));
      }
      setProducts(rows);
      setLoading(false);
    });
  }, [activeCategory, search, minPrice, maxPrice, sort]);

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
      .limit(10)
      .then(({ data }) => setFeatured((data as unknown as Product[]) ?? []));

    supabase
      .from("stores")
      .select("id, name, slug, logo_url, status, merchants ( status )")
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
      .select("id, name, slug, logo_url, status, merchants ( status )")
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
      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <Input
            type="search"
            placeholder="Search products and shops..."
            value={search}
            onChange={(e) => updateParam("q", e.target.value)}
            className="pl-9"
          />
        </div>
        <Button variant="outline" onClick={() => setFilterSheetOpen(true)} className="flex-shrink-0">
          <SlidersHorizontal className="w-4 h-4" />
          <span className="hidden sm:inline">Filters</span>
        </Button>
      </div>

      <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
        <button
          onClick={() => updateParam("category", "")}
          className={`px-3 py-1.5 rounded-full text-sm border flex-shrink-0 ${
            activeCategory === null ? "bg-navy text-white border-navy" : "bg-white"
          }`}
        >
          All
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => updateParam("category", c.id)}
            className={`px-3 py-1.5 rounded-full text-sm border flex-shrink-0 ${
              activeCategory === c.id ? "bg-navy text-white border-navy" : "bg-white"
            }`}
          >
            {c.name}
          </button>
        ))}
      </div>

      {!hasActiveFilters && (
        <>
          <ScrollRow title="Shop by category">
            {categories.map((c) => (
              <CategoryTile key={c.id} name={c.name} imageUrl={c.image_url} onClick={() => updateParam("category", c.id)} />
            ))}
          </ScrollRow>

          {featured && featured.length > 0 && (
            <ScrollRow title="Featured products">
              {featured.map((p) => (
                <ProductCard key={p.id} product={p} rating={ratings.get(p.merchant_id)} className="w-40 flex-shrink-0" />
              ))}
            </ScrollRow>
          )}

          {shops && shops.length > 0 && (
            <ScrollRow title="Discover shops" seeAllTo="/stores">
              {shops.map((s) => (
                <ShopCard key={s.id} slug={s.slug} name={s.name} photoUrl={s.logo_url} subtitle="" className="w-40 flex-shrink-0" />
              ))}
            </ScrollRow>
          )}

          <h2 className="font-semibold text-base mb-2">All products</h2>
        </>
      )}

      {hasActiveFilters && shopMatches.length > 0 && (
        <ScrollRow title="Shops">
          {shopMatches.map((s) => (
            <ShopCard key={s.id} slug={s.slug} name={s.name} photoUrl={s.logo_url} subtitle="" className="w-40 flex-shrink-0" />
          ))}
        </ScrollRow>
      )}

      {loading ? (
        <SkeletonRows count={4} />
      ) : products.length === 0 ? (
        <EmptyState icon={hasActiveFilters ? PackageSearch : StoreIcon} title="No products found" description="Try adjusting your search or filters." />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} rating={ratings.get(p.merchant_id)} />
          ))}
        </div>
      )}

      <Sheet
        open={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        title="Filters & sort"
        footer={
          <Button className="w-full" onClick={() => setFilterSheetOpen(false)}>
            Show results
          </Button>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Sort by</label>
            <select
              value={sort}
              onChange={(e) => updateParam("sort", e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Min price</label>
              <Input type="number" min={0} placeholder="0" value={minPrice} onChange={(e) => updateParam("min_price", e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Max price</label>
              <Input type="number" min={0} placeholder="Any" value={maxPrice} onChange={(e) => updateParam("max_price", e.target.value)} />
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
              Clear filters
            </button>
          )}
        </div>
      </Sheet>
    </div>
  );
}
