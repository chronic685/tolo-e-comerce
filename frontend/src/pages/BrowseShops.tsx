import { useEffect, useState } from "react";
import { Store } from "lucide-react";
import { CUSTOMER_PAGE_SIZE, EmptyState, Pagination, SkeletonRows, totalPagesFor, usePagination, useTranslation } from "@tolo/ui";
import { supabase } from "../lib/supabase";
import { ShopCard } from "../components/ShopCard";
import { fetchMerchantRatings } from "../lib/merchantRatings";
import type { MerchantRating } from "../types";

interface ShopRow {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  status: string;
  merchant_id: string;
  merchants: { status: string; is_test: boolean } | null;
}

interface ShopSummary {
  categoryNames: string[];
  productNames: string[];
  // The shop's most-recently-added product image, used as the card photo
  // when the shop has no logo_url of its own.
  latestProductImage: { url: string; createdAt: string } | null;
}

export function BrowseShops() {
  const { t } = useTranslation();
  const [shops, setShops] = useState<ShopRow[] | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [summaries, setSummaries] = useState<Map<string, ShopSummary>>(new Map());
  const [ratings, setRatings] = useState<Map<string, MerchantRating>>(new Map());
  const { page, from, to, setPage } = usePagination({ pageSize: CUSTOMER_PAGE_SIZE });

  useEffect(() => {
    setShops(null);
    // Same "open" definition Storefront.tsx used to apply client-side — a
    // store row can be RLS-visible (status='active') while its merchant
    // account is suspended, which isn't something a browse listing should
    // surface as a live shop either. Pushed into the query itself (rather
    // than filtered after fetching) so .range()/count reflect the real,
    // filtered page -- this REQUIRES the `!inner` embed hint below, or
    // PostgREST treats merchants as a left join: a row whose merchant
    // fails the filter comes back with merchants: null instead of being
    // excluded, leaving the store (and the wrong product/shop) in the
    // result set. (A previous version of this comment claimed PostgREST
    // did this automatically -- it doesn't; that was the actual bug that
    // let "QA TEST Store — DO NOT USE" stay publicly listed even once a
    // status/is_test filter was added here, see migration 0079.)
    // merchants.is_test excludes QA/CI fixture merchants -- they're
    // otherwise indistinguishable from a real one here, since the fixture
    // deliberately sets status: 'active' too.
    supabase
      .from("stores")
      .select("id, name, slug, logo_url, status, merchant_id, merchants!inner ( status, is_test )", { count: "exact" })
      .eq("status", "active")
      .in("merchants.status", ["active", "approved"])
      .eq("merchants.is_test", false)
      .order("name")
      .range(from, to)
      .then(({ data, count }) => {
        setShops((data as unknown as ShopRow[]) ?? []);
        setTotalCount(count ?? 0);
      });
  }, [from, to]);

  useEffect(() => {
    if (!shops || shops.length === 0) return;
    // One batched query for every shop's merchant rating on the page —
    // never fetch a merchant's rating once per card (see merchantRatings.ts).
    fetchMerchantRatings(shops.map((s) => s.merchant_id)).then(setRatings);
  }, [shops]);

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
    if (!summary || (summary.categoryNames.length === 0 && summary.productNames.length === 0)) return t("browseShops.newShopNoProducts");
    if (summary.categoryNames.length > 0) return summary.categoryNames.slice(0, 3).join(" · ");
    // Uncategorized products still exist — fall back to naming a few of
    // them rather than showing nothing, same reasoning as Storefront.tsx's
    // "Uncategorized" group for products with no category_id.
    return summary.productNames.slice(0, 3).join(", ");
  }

  return (
    <div>
      <h1 className="text-xl font-bold mb-1">{t("nav.shops")}</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">{t("browseShops.subtitle")}</p>

      {shops === null ? (
        <SkeletonRows count={4} />
      ) : shops.length === 0 ? (
        <EmptyState icon={Store} title={t("browseShops.noShopsTitle")} description={t("browseShops.noShopsDescription")} />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {shops.map((shop) => {
              const rating = ratings.get(shop.merchant_id);
              return (
                <ShopCard
                  key={shop.id}
                  slug={shop.slug}
                  name={shop.name}
                  photoUrl={photoUrl(shop)}
                  subtitle={summaryLine(shop.id)}
                  avgRating={rating?.avg_rating}
                  reviewCount={rating?.review_count}
                />
              );
            })}
          </div>
          <div className="mt-6">
            <Pagination page={page} totalPages={totalPagesFor(totalCount, CUSTOMER_PAGE_SIZE)} onPageChange={setPage} />
          </div>
        </>
      )}
    </div>
  );
}
