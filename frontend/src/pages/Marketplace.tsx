import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { ProductCard } from "../components/ProductCard";
import type { Category, Product } from "../types";

const PRODUCT_SELECT = `
  id, merchant_id, store_id, category_id, name, slug, description, base_price, discount_price, status,
  customer_price:products_customer_price,
  product_variants ( id, sku, attributes, price, discount_price, is_default ),
  product_images ( id, url, is_primary, variant_id ),
  stores ( name, slug )
`;

export function Marketplace() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("categories")
      .select("id, name, slug, image_url")
      .eq("is_active", true)
      .order("sort_order")
      .then(({ data }) => setCategories(data ?? []));
  }, []);

  useEffect(() => {
    setLoading(true);
    let query = supabase
      .from("products")
      .select(PRODUCT_SELECT)
      .eq("status", "published")
      .order("created_at", { ascending: false });

    if (activeCategory) query = query.eq("category_id", activeCategory);
    if (search.trim()) query = query.ilike("name", `%${search.trim()}%`);

    query.then(({ data }) => {
      setProducts((data as unknown as Product[]) ?? []);
      setLoading(false);
    });
  }, [activeCategory, search]);

  return (
    <div>
      <div className="mb-6">
        <input
          type="search"
          placeholder="Search products..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-md border rounded-md px-3 py-2 text-sm"
        />
      </div>

      <div className="flex gap-2 mb-6 flex-wrap">
        <button
          onClick={() => setActiveCategory(null)}
          className={`px-3 py-1.5 rounded-full text-sm border ${
            activeCategory === null ? "bg-emerald-600 text-white border-emerald-600" : "bg-white"
          }`}
        >
          All
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => setActiveCategory(c.id)}
            className={`px-3 py-1.5 rounded-full text-sm border ${
              activeCategory === c.id ? "bg-emerald-600 text-white border-emerald-600" : "bg-white"
            }`}
          >
            {c.name}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-gray-500">Loading products...</p>
      ) : products.length === 0 ? (
        <p className="text-gray-500">No products found.</p>
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
