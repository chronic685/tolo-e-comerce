import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { PackageSearch } from "lucide-react";
import { CUSTOMER_PAGE_SIZE, EmptyState, LazyImage, Pagination, SkeletonPage, SkeletonRows, totalPagesFor, usePagination } from "@tolo/ui";
import { supabase } from "../lib/supabase";
import { ProductCard } from "../components/ProductCard";
import { RatingBadge } from "../components/RatingBadge";
import type { Product, StorefrontStore } from "../types";

const PRODUCT_SELECT = `
  id, merchant_id, store_id, category_id, name, slug, description, base_price, discount_price, status,
  customer_price:products_customer_price,
  product_variants ( id, sku, attributes, price, discount_price, is_default, stock_status:variant_stock_status, stock_remaining:variant_stock_remaining ),
  product_images ( id, url, is_primary, variant_id ),
  stores ( name, slug ),
  categories ( name )
`;

interface StoreCategory {
  id: string;
  name: string;
}

// A storefront is only shown as open when BOTH the store's own status
// (merchant-controlled, via merchant-dashboard Store Settings) and the
// merchant account's status (Tolo-controlled) indicate it's actually
// operating — mirrors create_order()'s own merchant-availability check
// exactly (`merchants.status in ('active', 'approved')`, migration 0036)
// rather than inventing a separate definition of "open" for this page.
//
// In practice the store.status half of this is already enforced one layer
// down: the "stores_public_select_active" RLS policy (migration 0014) only
// lets an anonymous/customer session SELECT a store row at all when
// status = 'active' — a draft/paused/suspended/closed store's row is
// invisible at the query level, not just hidden by this function, so it
// comes back indistinguishable from a slug that never existed (see the
// store === null branch below). The merchants.status half is NOT covered
// by that policy (it only looks at the store's own status column), so it's
// the one case this function actually adds: a store can be status='active'
// and still readable, while its merchant account is suspended by Tolo.
function isStoreOpen(store: StorefrontStore): boolean {
  return store.status === "active" && (store.merchants?.status === "active" || store.merchants?.status === "approved");
}

export function Storefront() {
  const { slug } = useParams();
  // undefined = still loading, null = no store matches this slug at all.
  const [store, setStore] = useState<StorefrontStore | null | undefined>(undefined);
  const [products, setProducts] = useState<Product[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [productsLoading, setProductsLoading] = useState(true);
  const [categories, setCategories] = useState<StoreCategory[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const { page, from, to, setPage } = usePagination({ pageSize: CUSTOMER_PAGE_SIZE, resetKey: `${store?.id ?? ""}:${activeCategory ?? ""}` });

  useEffect(() => {
    setStore(undefined);
    supabase
      .from("stores")
      .select(
        "id, merchant_id, name, slug, description, logo_url, banner_url, status, " +
          "merchants ( status, avg_rating:merchants_avg_rating, review_count:merchants_review_count )",
      )
      .eq("slug", slug)
      .maybeSingle()
      .then(({ data }) => {
        setStore((data as unknown as StorefrontStore) ?? null);
      });
  }, [slug]);

  useEffect(() => {
    if (!store || !isStoreOpen(store)) return;
    // Lightweight metadata query (two columns), same treatment Marketplace.tsx
    // gives its own global category list -- not the paginated product list
    // itself, just what's needed to build the filter pills.
    supabase
      .from("products")
      .select("category_id, categories ( name )")
      .eq("store_id", store.id)
      .eq("status", "published")
      .then(({ data }) => {
        const rows = (data as unknown as { category_id: string | null; categories: { name: string } | null }[]) ?? [];
        const seen = new Map<string, string>();
        for (const row of rows) {
          if (row.category_id && row.categories?.name) seen.set(row.category_id, row.categories.name);
        }
        setCategories([...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)));
      });
  }, [store]);

  useEffect(() => {
    if (!store || !isStoreOpen(store)) {
      setProductsLoading(false);
      return;
    }
    setProductsLoading(true);
    let query = supabase.from("products").select(PRODUCT_SELECT, { count: "exact" }).eq("store_id", store.id).eq("status", "published");
    if (activeCategory) query = query.eq("category_id", activeCategory);
    query
      .order("created_at", { ascending: false })
      .range(from, to)
      .then(({ data, count }) => {
        setProducts((data as unknown as Product[]) ?? []);
        setTotalCount(count ?? 0);
        setProductsLoading(false);
      });
  }, [store, activeCategory, from, to]);

  // logo_url first; if the shop hasn't set one, fall back to its most
  // recently added product's photo (products is already ordered by
  // created_at desc, so products[0] is that product — no extra query
  // needed). null if neither exists, rendered as the same neutral gray box
  // ProductCard.tsx already uses in place of a generic placeholder image
  // (there isn't one anywhere in this codebase to reuse).
  const storePhoto = store?.logo_url ?? products[0]?.product_images.find((i) => i.is_primary)?.url ?? products[0]?.product_images[0]?.url ?? null;

  if (store === undefined) return <SkeletonPage />;

  // A slug that matches nothing is a genuine 404 — an invalid/mistyped link.
  // This is also what a real but non-active store's slug looks like from
  // here, since RLS hides that row entirely rather than returning it with
  // a non-active status (see isStoreOpen's comment above) — there's no way
  // to tell those two cases apart at this layer, so they're not
  // distinguished in the UI either.
  if (store === null) {
    return (
      <div className="max-w-lg mx-auto text-center py-12">
        <h1 className="text-xl font-bold mb-2">Store not found</h1>
        <p className="text-gray-500 text-sm">This store link doesn't match any shop on Tolo — check the link and try again.</p>
      </div>
    );
  }

  // Reachable only for a store whose own status is 'active' (per RLS) but
  // whose merchant account Tolo has suspended — a soft "unavailable"
  // message rather than a 404, since the row is genuinely readable and a
  // bookmarked/shared link shouldn't look broken, without leaking why.
  if (!isStoreOpen(store)) {
    return (
      <div className="max-w-lg mx-auto text-center py-12">
        <h1 className="text-xl font-bold mb-2">{store.name}</h1>
        <p className="text-gray-500 text-sm">This store isn't available right now. Please check back later.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="bg-white border rounded-lg overflow-hidden mb-6">
        {store.banner_url && <LazyImage src={store.banner_url} alt="" aspect="aspect-[3/1]" />}
        <div className="p-4 flex items-center gap-4">
          <div className="w-16 h-16 rounded-full border flex-shrink-0 overflow-hidden">
            <LazyImage src={storePhoto} alt={store.name} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold truncate">{store.name}</h1>
            <RatingBadge avgRating={store.merchants?.avg_rating ?? null} reviewCount={store.merchants?.review_count ?? 0} />
            {store.description && <p className="text-sm text-gray-500 mt-1">{store.description}</p>}
          </div>
        </div>
      </div>

      {categories.length > 1 && (
        <div className="flex gap-2 mb-4 flex-wrap">
          <button
            onClick={() => setActiveCategory(null)}
            className={`px-3 py-1.5 rounded-full text-sm border ${activeCategory === null ? "bg-navy text-white border-navy" : "bg-white"}`}
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveCategory(c.id)}
              className={`px-3 py-1.5 rounded-full text-sm border ${activeCategory === c.id ? "bg-navy text-white border-navy" : "bg-white"}`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {productsLoading ? (
        <SkeletonRows count={4} />
      ) : products.length === 0 ? (
        <EmptyState icon={PackageSearch} title="No products yet" description="This store hasn't listed anything yet." />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {products.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
          <div className="mt-6">
            <Pagination page={page} totalPages={totalPagesFor(totalCount, CUSTOMER_PAGE_SIZE)} onPageChange={setPage} />
          </div>
        </>
      )}
    </div>
  );
}
