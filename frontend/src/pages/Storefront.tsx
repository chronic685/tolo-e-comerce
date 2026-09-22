import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { ProductCard } from "../components/ProductCard";
import { RatingBadge } from "../components/RatingBadge";
import type { Product, StorefrontStore } from "../types";

const PRODUCT_SELECT = `
  id, merchant_id, store_id, category_id, name, slug, description, base_price, discount_price, status,
  customer_price:products_customer_price,
  product_variants ( id, sku, attributes, price, discount_price, is_default ),
  product_images ( id, url, is_primary, variant_id ),
  stores ( name, slug ),
  categories ( name )
`;

// One group per distinct category among this store's products, plus an
// "Uncategorized" group (only shown if non-empty) for anything with a null
// category_id — a shop mid-way through categorizing its catalog shouldn't
// have products silently disappear from its own storefront.
function groupByCategory(products: Product[]): { name: string; products: Product[] }[] {
  const groups = new Map<string, { name: string; products: Product[] }>();
  for (const p of products) {
    const key = p.category_id ?? "__uncategorized__";
    const name = p.categories?.name ?? "Uncategorized";
    if (!groups.has(key)) groups.set(key, { name, products: [] });
    groups.get(key)!.products.push(p);
  }
  return [...groups.values()];
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
  const [productsLoading, setProductsLoading] = useState(true);

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
    if (!store || !isStoreOpen(store)) {
      setProductsLoading(false);
      return;
    }
    setProductsLoading(true);
    supabase
      .from("products")
      .select(PRODUCT_SELECT)
      .eq("store_id", store.id)
      .eq("status", "published")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setProducts((data as unknown as Product[]) ?? []);
        setProductsLoading(false);
      });
  }, [store]);

  const categoryGroups = groupByCategory(products);

  if (store === undefined) return <p className="text-gray-500">Loading...</p>;

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
      {store.banner_url && (
        <div className="w-full h-40 bg-gray-100 rounded-lg overflow-hidden mb-4">
          <img src={store.banner_url} alt="" className="w-full h-full object-cover" />
        </div>
      )}
      <div className="flex items-center gap-4 mb-6">
        {store.logo_url && (
          <img src={store.logo_url} alt={store.name} className="w-16 h-16 rounded-full object-cover border flex-shrink-0" />
        )}
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold">{store.name}</h1>
            <RatingBadge avgRating={store.merchants?.avg_rating ?? null} reviewCount={store.merchants?.review_count ?? 0} />
          </div>
          {store.description && <p className="text-sm text-gray-500 mt-0.5">{store.description}</p>}
        </div>
      </div>

      {productsLoading ? (
        <p className="text-gray-500">Loading products...</p>
      ) : products.length === 0 ? (
        <p className="text-gray-500">This store doesn't have any products listed yet.</p>
      ) : categoryGroups.length > 1 ? (
        <div className="space-y-6">
          {categoryGroups.map((group) => (
            <details key={group.name} open className="group">
              <summary className="cursor-pointer font-semibold text-sm mb-3 list-none flex items-center gap-1.5">
                <span className="text-gray-400 group-open:rotate-90 transition-transform inline-block">▸</span>
                {group.name}
                <span className="text-gray-400 font-normal">({group.products.length})</span>
              </summary>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {group.products.map((p) => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </div>
            </details>
          ))}
        </div>
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
