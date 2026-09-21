import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { ProductCard } from "../components/ProductCard";
import type { Category, Product } from "../types";

const PRODUCT_SELECT = `
  id, merchant_id, store_id, category_id, name, slug, description, base_price, discount_price, status,
  customer_price:products_customer_price,
  product_variants ( id, sku, attributes, price, discount_price, is_default ),
  product_images ( id, url, is_primary, variant_id ),
  stores ( name, slug ),
  reviews ( rating )
`;

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

  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

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
    // isn't what a customer actually pays. Confirmed PostgREST supports
    // both filtering and ordering by a computed column directly (no schema
    // change needed for this — it's the same products_customer_price
    // function every other customer-facing price already goes through).
    if (minPrice) query = query.gte("products_customer_price", Number(minPrice));
    if (maxPrice) query = query.lte("products_customer_price", Number(maxPrice));

    if (sort === "price_asc") query = query.order("products_customer_price", { ascending: true });
    else if (sort === "price_desc") query = query.order("products_customer_price", { ascending: false });
    else query = query.order("created_at", { ascending: false });

    query.then(({ data }) => {
      let rows = (data as unknown as Product[]) ?? [];
      if (sort === "rating_desc") {
        // No merchant- or product-level rating aggregate exists as a
        // queryable column anywhere (checked first — only raw per-review
        // rows do) — averaged here from the embedded reviews instead of
        // adding one, since this page's own scope is bolting filters onto
        // the existing query, not a schema change.
        rows = [...rows].sort((a, b) => averageRating(b) - averageRating(a));
      }
      setProducts(rows);
      setLoading(false);
    });
  }, [activeCategory, search, minPrice, maxPrice, sort]);

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4 items-end">
        <input
          type="search"
          placeholder="Search products..."
          value={search}
          onChange={(e) => updateParam("q", e.target.value)}
          className="flex-1 min-w-[160px] border rounded-md px-3 py-2 text-sm"
        />
        <div>
          <label className="text-xs text-gray-500 block mb-1">Min price</label>
          <input
            type="number"
            min={0}
            placeholder="0"
            value={minPrice}
            onChange={(e) => updateParam("min_price", e.target.value)}
            className="w-24 border rounded-md px-2 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Max price</label>
          <input
            type="number"
            min={0}
            placeholder="Any"
            value={maxPrice}
            onChange={(e) => updateParam("max_price", e.target.value)}
            className="w-24 border rounded-md px-2 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Sort by</label>
          <select
            value={sort}
            onChange={(e) => updateParam("sort", e.target.value)}
            className="border rounded-md px-2 py-2 text-sm"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex gap-2 mb-6 flex-wrap">
        <button
          onClick={() => updateParam("category", "")}
          className={`px-3 py-1.5 rounded-full text-sm border ${
            activeCategory === null ? "bg-navy text-white border-navy" : "bg-white"
          }`}
        >
          All
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => updateParam("category", c.id)}
            className={`px-3 py-1.5 rounded-full text-sm border ${
              activeCategory === c.id ? "bg-navy text-white border-navy" : "bg-white"
            }`}
          >
            {c.name}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-gray-500">Loading products...</p>
      ) : products.length === 0 ? (
        <p className="text-gray-500">No products found.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </div>
  );
}
