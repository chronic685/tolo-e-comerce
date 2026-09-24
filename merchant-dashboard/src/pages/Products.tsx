import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useMerchant } from "../lib/MerchantContext";
import type { Product } from "../types";

const PRODUCT_SELECT = `
  id, merchant_id, store_id, category_id, name, slug, description, base_price, discount_price, status,
  product_variants ( id, product_id, sku, attributes, price, discount_price, is_default, inventory ( stock_quantity, reserved_quantity, available_quantity ) ),
  product_images ( id, url, is_primary ),
  categories ( name )
`;

const statusColors: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  submitted: "bg-yellow-100 text-yellow-800",
  approved: "bg-blue-100 text-blue-800",
  published: "bg-emerald-100 text-emerald-800",
  paused: "bg-orange-100 text-orange-800",
  archived: "bg-red-100 text-red-800",
};

export function Products() {
  const { merchant, store } = useMerchant();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [bulkUploadEnabled, setBulkUploadEnabled] = useState(false);

  useEffect(() => {
    // Platform-wide toggle (admin-dashboard Settings.tsx, merchant_features
    // .bulk_upload_enabled) — there's no per-merchant override for any
    // merchant_features flag in this schema, so this is the same value for
    // every merchant.
    supabase
      .from("system_settings")
      .select("value")
      .eq("key", "merchant_features")
      .maybeSingle()
      .then(({ data }) => {
        const features = data?.value as { bulk_upload_enabled?: boolean } | null;
        setBulkUploadEnabled(features?.bulk_upload_enabled ?? false);
      });
  }, []);

  async function load() {
    if (!merchant) return;
    setLoading(true);
    const { data } = await supabase
      .from("products")
      .select(PRODUCT_SELECT)
      .eq("merchant_id", merchant.id)
      .order("created_at", { ascending: false });
    setProducts((data as unknown as Product[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchant]);

  async function togglePause(p: Product) {
    const next = p.status === "published" ? "paused" : "published";
    const { error } = await supabase.from("products").update({ status: next }).eq("id", p.id);
    if (error) return;
    setProducts((prev) => prev.map((prod) => (prod.id === p.id ? { ...prod, status: next } : prod)));
  }

  if (!store) {
    return <p className="text-gray-600">Set up your store profile before adding products. Go to Store Settings.</p>;
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-xl font-bold">Products</h1>
        <div className="flex items-center gap-2">
          {bulkUploadEnabled && (
            <Link to="/products-bulk-upload" className="text-sm border px-4 py-2 rounded-md hover:bg-gray-50">
              Bulk upload
            </Link>
          )}
          <Link to="/products/new" className="bg-navy text-white text-sm px-4 py-2 rounded-md hover:bg-navy-dark">
            + New product
          </Link>
        </div>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : products.length === 0 ? (
        <p className="text-gray-500">No products yet.</p>
      ) : (
        <div className="bg-white border rounded-lg divide-y">
          {products.map((p) => {
            const totalStock = p.product_variants.reduce((sum, v) => sum + (v.inventory?.stock_quantity ?? 0), 0);
            return (
              <div key={p.id} className="flex items-center gap-4 p-4">
                <div className="w-14 h-14 bg-gray-100 rounded overflow-hidden flex-shrink-0">
                  {p.product_images[0] && (
                    <img src={p.product_images[0].url} alt={p.name} className="w-full h-full object-cover" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <Link to={`/products/${p.id}`} className="font-medium hover:text-navy truncate block">
                    {p.name}
                  </Link>
                  <p className="text-xs text-gray-500">
                    {p.categories?.name ?? "Uncategorized"} · Stock: {totalStock}
                  </p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${statusColors[p.status]}`}>
                  {p.status}
                </span>
                <p className="font-semibold text-sm w-24 text-right">{p.base_price.toFixed(2)} ETB</p>
                {(p.status === "published" || p.status === "paused") && (
                  <button
                    onClick={() => togglePause(p)}
                    className="text-xs text-gray-600 hover:text-gray-900 border rounded-md px-2 py-1"
                  >
                    {p.status === "published" ? "Pause" : "Publish"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
