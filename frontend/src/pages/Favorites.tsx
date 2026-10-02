import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Heart } from "lucide-react";
import { Button, CUSTOMER_PAGE_SIZE, EmptyState, Pagination, SkeletonRows, totalPagesFor, usePagination, useTranslation } from "@tolo/ui";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { ProductCard } from "../components/ProductCard";
import type { Product } from "../types";

const PRODUCT_SELECT = `
  id, merchant_id, store_id, category_id, name, slug, description, base_price, discount_price, status,
  customer_price:products_customer_price,
  product_variants ( id, sku, attributes, price, discount_price, is_default, stock_status:variant_stock_status, stock_remaining:variant_stock_remaining ),
  product_images ( id, url, is_primary, variant_id ),
  stores ( name, slug )
`;

export function Favorites() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const { page, from, to, setPage } = usePagination({ pageSize: CUSTOMER_PAGE_SIZE });

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    supabase
      .from("customer_favorites")
      .select(`product_id, products ( ${PRODUCT_SELECT} )`, { count: "exact" })
      .eq("customer_id", user.id)
      .not("product_id", "is", null)
      .range(from, to)
      .then(({ data, count }) => {
        const rows = (data as unknown as { products: Product | null }[]) ?? [];
        setProducts(rows.map((r) => r.products).filter((p): p is Product => p !== null));
        setTotalCount(count ?? 0);
        setLoading(false);
      });
  }, [user, from, to]);

  if (!user) return <p className="text-gray-500 dark:text-gray-400">{t("favorites.signInPrompt")}</p>;
  if (loading) return <SkeletonRows count={4} />;

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">{t("account.favorites")}</h1>
      {products.length === 0 ? (
        <EmptyState
          icon={Heart}
          title={t("emptyState.noFavorites")}
          description={t("favorites.description")}
          action={<Button onClick={() => navigate("/")}>{t("cart.browseMarketplace")}</Button>}
        />
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
