import { useEffect, useState } from "react";
import { useTranslation } from "@tolo/ui";
import { supabase } from "../lib/supabase";
import { getRecentlyViewedIds } from "../lib/recentlyViewed";
import { ScrollRow } from "./ScrollRow";
import { ProductCard } from "./ProductCard";
import type { Product } from "../types";

const PRODUCT_SELECT = `
  id, merchant_id, store_id, category_id, name, slug, description, base_price, discount_price, status,
  customer_price:products_customer_price,
  product_variants ( id, sku, attributes, price, discount_price, is_default, stock_status:variant_stock_status, stock_remaining:variant_stock_remaining ),
  product_images ( id, url, is_primary, variant_id ),
  stores ( name, slug ),
  merchants!inner ( is_test )
`;

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
    // merchants.is_test excludes a QA/CI fixture product (migration 0079) —
    // a stale localStorage entry from before this filter existed shouldn't
    // resurface one.
    supabase
      .from("products")
      .select(PRODUCT_SELECT)
      .in("id", ids)
      .eq("status", "published")
      .eq("merchants.is_test", false)
      .then(({ data }) => {
        const byId = new Map(((data as unknown as Product[]) ?? []).map((p) => [p.id, p]));
        // Re-sort to the original most-recent-first order -- `.in()` does
        // not preserve the id list's order.
        setProducts(ids.map((id) => byId.get(id)).filter((p): p is Product => p !== undefined));
      });
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
