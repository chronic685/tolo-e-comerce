import { useEffect, useState } from "react";
import { useTranslation } from "@tolo/ui";
import { catalogue } from "../data/catalogue";
import { getRecentlyViewedIds } from "../lib/recentlyViewed";
import { ScrollRow } from "./ScrollRow";
import { ProductCard } from "./ProductCard";
import type { Product } from "../types";

/** Item 7: "recently viewed row" on the customer site -- backed by
 * lib/recentlyViewed.ts's localStorage list (ProductDetail.tsx records each
 * view). Renders nothing until there's at least one still-published match,
 * so a first-time visitor or an all-delisted history never leaves a title
 * with nothing under it. */
export function RecentlyViewedRow() {
  const { t } = useTranslation();
  const [products, setProducts] = useState<Product[] | null>(null);

  useEffect(() => {
    const ids = getRecentlyViewedIds();
    if (ids.length === 0) {
      setProducts([]);
      return;
    }
    // The adapter leaves out anything no longer published (and QA/CI fixtures) and keeps the most-recent-first order.
    catalogue.getProductsByIds(ids).then(setProducts);
  }, []);

  if (!products || products.length === 0) return null;

  return (
    <ScrollRow title={t("recentlyViewed.title")}>
      {products.map((p) => (
        <ProductCard key={p.id} product={p} className="w-40 flex-shrink-0" />
      ))}
    </ScrollRow>
  );
}
