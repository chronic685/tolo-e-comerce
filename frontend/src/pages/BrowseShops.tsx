import { useEffect, useState, type ReactNode } from "react";
import { Store } from "lucide-react";
import { CategoryIcon, CUSTOMER_PAGE_SIZE, EmptyState, Pagination, SkeletonRows, totalPagesFor, useCategoryName, usePagination, useTranslation } from "@tolo/ui";
import { catalogue, type Shop, type ShopSummary } from "../data/catalogue";
import { ShopCard } from "../components/ShopCard";
import { fetchMerchantRatings } from "../lib/merchantRatings";
import type { MerchantRating } from "../types";

export function BrowseShops() {
  const { t } = useTranslation();
  const categoryName = useCategoryName();
  const [shops, setShops] = useState<Shop[] | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [summaries, setSummaries] = useState<Map<string, ShopSummary>>(new Map());
  const [ratings, setRatings] = useState<Map<string, MerchantRating>>(new Map());
  const { page, setPage } = usePagination({ pageSize: CUSTOMER_PAGE_SIZE });

  useEffect(() => {
    setShops(null);
    // Only shops a customer may see (open, not a QA/CI fixture) come back, already filtered, so the page and count are the real ones.
    catalogue.listShops({ page, pageSize: CUSTOMER_PAGE_SIZE }).then(({ items, total }) => {
      setShops(items);
      setTotalCount(total);
    });
  }, [page]);

  useEffect(() => {
    if (!shops || shops.length === 0) return;
    // One batched query for every shop's merchant rating on the page —
    // never fetch a merchant's rating once per card (see merchantRatings.ts).
    fetchMerchantRatings(shops.map((s) => s.merchant_id)).then(setRatings);
  }, [shops]);

  useEffect(() => {
    if (!shops || shops.length === 0) return;
    // This page only needs category names + a few product names + a photo per shop, not the full product rows.
    catalogue.getShopSummaries(shops).then(setSummaries);
  }, [shops]);

  function photoUrl(shop: Shop): string | null {
    return shop.logo_url ?? summaries.get(shop.id)?.latestProductImage?.url ?? null;
  }

  function summaryLine(shopId: string): ReactNode {
    const summary = summaries.get(shopId);
    if (!summary || (summary.categories.length === 0 && summary.productNames.length === 0)) return t("browseShops.newShopNoProducts");
    if (summary.categories.length > 0) {
      return (
        <span className="flex flex-wrap gap-x-2 gap-y-1">
          {summary.categories.slice(0, 3).map((c) => (
            <span key={c.name} className="inline-flex items-center gap-1">
              <CategoryIcon icon={c.icon} color={c.color} size="xs" />
              {categoryName(c)}
            </span>
          ))}
        </span>
      );
    }
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
