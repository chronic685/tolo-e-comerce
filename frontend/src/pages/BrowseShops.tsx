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
      .select("store_id, name, categories ( name )")
      .eq("status", "published")
      .in(
        "store_id",
        shops.map((s) => s.id),
      )
      .then(({ data }) => {
        const rows = (data as unknown as { store_id: string; name: string; categories: { name: string } | null }[]) ?? [];
        const map = new Map<string, ShopSummary>();
        for (const row of rows) {
          const entry = map.get(row.store_id) ?? { categoryNames: [], productNames: [] };
          if (row.categories?.name && !entry.categoryNames.includes(row.categories.name)) entry.categoryNames.push(row.categories.name);
          entry.productNames.push(row.name);
          map.set(row.store_id, entry);
        }
        setSummaries(map);
      });
  }, [shops]);

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
          {shops.map((shop) => (
            <Link key={shop.id} to={`/stores/${shop.slug}`} className="bg-white border rounded-lg p-4 hover:shadow-md transition-shadow">
              <div className="flex items-center gap-3 mb-2">
                {shop.logo_url ? (
                  <img src={shop.logo_url} alt={shop.name} className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-navy-50 text-navy flex items-center justify-center font-bold flex-shrink-0">
                    {shop.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <p className="font-medium text-sm leading-tight">{shop.name}</p>
              </div>
              <p className="text-xs text-gray-500 line-clamp-2">{summaryLine(shop.id)}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
