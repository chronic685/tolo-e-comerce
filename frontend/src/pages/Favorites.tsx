import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { ProductCard } from "../components/ProductCard";
import type { Product } from "../types";

const PRODUCT_SELECT = `
  id, merchant_id, store_id, category_id, name, slug, description, base_price, discount_price, status,
  customer_price:products_customer_price,
  product_variants ( id, sku, attributes, price, discount_price, is_default ),
  product_images ( id, url, is_primary, variant_id ),
  stores ( name, slug )
`;

export function Favorites() {
  const { user } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("customer_favorites")
      .select(`product_id, products ( ${PRODUCT_SELECT} )`)
      .eq("customer_id", user.id)
      .not("product_id", "is", null)
      .then(({ data }) => {
        const rows = (data as unknown as { products: Product | null }[]) ?? [];
        setProducts(rows.map((r) => r.products).filter((p): p is Product => p !== null));
        setLoading(false);
      });
  }, [user]);

  if (!user) return <p className="text-gray-500">Sign in to see your favorites.</p>;
  if (loading) return <p className="text-gray-500">Loading...</p>;

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">Favorites</h1>
      {products.length === 0 ? (
        <p className="text-gray-500">You haven't favorited any products yet.</p>
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
