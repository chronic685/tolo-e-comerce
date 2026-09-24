import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";

interface ShopRow {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  status: string;
  merchants: { status: string } | null;
}

interface ShopSummary {
  categoryNames: string[];
  productNames: string[];
  // The shop's most-recently-added product image, used as the card photo
  // when the shop has no logo_url of its own.
  latestProductImage: { url: string; createdAt: string } | null;
}

// Same "open" definition Storefront.tsx uses — a store row can be RLS-
// visible (status='active') while its merchant account is suspended, which
// isn't something a browse listing should surface as a live shop either.
function isStoreOpen(store: ShopRow): boolean {
  return store.status === "active" && (store.merchants?.status === "active" || store.merchants?.status === "approved");
}

export function BrowseShops() {
  const [shops, setShops] = useState<ShopRow[] | null>(null);
  const [summaries, setSummaries] = useState<Map<string, ShopSummary>>(new Map());

  useEffect(() => {
    supabase
      .from("stores")
      .select("id, name, slug, logo_url, status, merchants ( status )")
      .then(({ data }) => {
        const rows = ((data as unknown as ShopRow[]) ?? []).filter(isStoreOpen);
        setShops(rows);
      });
  }, []);

  useEffect(() => {
    if (!shops || shops.length === 0) return;
    // One query for every shop's products rather than N+1 per-card queries
    // — this page only needs category names + a few product names, not the
    // full product rows Storefront.tsx/ProductCard need.
    supabase
      .from("products")
      .select("store_id, name, created_at, categories ( name ), product_images ( url, is_primary )")
      .eq("status", "published")
      .in(
        "store_id",
        shops.map((s) => s.id),
      )
      .then(({ data }) => {
        const rows =
          (data as unknown as {
            store_id: string;
            name: string;
            created_at: string;
            categories: { name: string } | null;
            product_images: { url: string; is_primary: boolean }[];
          }[]) ?? [];
        const map = new Map<string, ShopSummary>();
        for (const row of rows) {
          const entry = map.get(row.store_id) ?? { categoryNames: [], productNames: [], latestProductImage: null };
          if (row.categories?.name && !entry.categoryNames.includes(row.categories.name)) entry.categoryNames.push(row.categories.name);
          entry.productNames.push(row.name);

          const image = row.product_images.find((i) => i.is_primary) ?? row.product_images[0];
          if (image && (!entry.latestProductImage || row.created_at > entry.latestProductImage.createdAt)) {
            entry.latestProductImage = { url: image.url, createdAt: row.created_at };
          }

          map.set(row.store_id, entry);
        }
        setSummaries(map);
      });
  }, [shops]);

  function photoUrl(shop: ShopRow): string | null {
    return shop.logo_url ?? summaries.get(shop.id)?.latestProductImage?.url ?? null;
  }

  function summaryLine(shopId: string): string {
    const summary = summaries.get(shopId);
    if (!summary || (summary.categoryNames.length === 0 && summary.productNames.length === 0)) return "New shop — no products yet";
    if (summary.categoryNames.length > 0) return summary.categoryNames.slice(0, 3).join(" · ");
    // Uncategorized products still exist — fall back to naming a few of
    // them rather than showing nothing, same reasoning as Storefront.tsx's
    // "Uncategorized" group for products with no category_id.
    return summary.productNames.slice(0, 3).join(", ");
  }

  return (
    <div>
      <h1 className="text-xl font-bold mb-1">Shops</h1>
      <p className="text-sm text-gray-500 mb-6">Browse every shop on Tolo.</p>

      {shops === null ? (
        <p className="text-gray-500">Loading...</p>
      ) : shops.length === 0 ? (
        <p className="text-gray-500">No shops are open right now.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {shops.map((shop) => {
            const photo = photoUrl(shop);
            return (
              <Link
                key={shop.id}
                to={`/stores/${shop.slug}`}
                className="block bg-white rounded-lg border hover:shadow-md transition-shadow overflow-hidden"
              >
                {/* Same "blank box, no placeholder graphic" convention
                    ProductCard.tsx already uses when there's no image at
                    all — this codebase has no generic placeholder image
                    asset anywhere, so this matches the existing fallback
                    rather than inventing one. */}
                <div className="aspect-square bg-gray-100">
                  {photo && <img src={photo} alt={shop.name} className="w-full h-full object-cover" />}
                </div>
                <div className="p-3">
                  <p className="font-medium text-sm truncate">{shop.name}</p>
                  <p className="text-xs text-gray-500 line-clamp-2 mt-0.5">{summaryLine(shop.id)}</p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
