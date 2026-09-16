import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { useCart } from "../lib/CartContext";
import type { Product } from "../types";

const PRODUCT_SELECT = `
  id, merchant_id, store_id, category_id, name, slug, description, base_price, discount_price, status,
  product_variants ( id, sku, attributes, price, discount_price, is_default ),
  product_images ( id, url, is_primary, variant_id ),
  stores ( name, slug )
`;

export function ProductDetail() {
  const { slug } = useParams();
  const { user } = useAuth();
  const { addItem } = useCart();
  const navigate = useNavigate();

  const [product, setProduct] = useState<Product | null>(null);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("products")
      .select(PRODUCT_SELECT)
      .eq("slug", slug)
      .eq("status", "published")
      .maybeSingle()
      .then(({ data }) => {
        const p = data as unknown as Product | null;
        setProduct(p);
        setVariantId(p?.product_variants.find((v) => v.is_default)?.id ?? p?.product_variants[0]?.id ?? null);
      });
  }, [slug]);

  if (!product) return <p className="text-gray-500">Loading...</p>;

  const variant = product.product_variants.find((v) => v.id === variantId);
  const image =
    product.product_images.find((i) => i.variant_id === variantId) ??
    product.product_images.find((i) => i.is_primary) ??
    product.product_images[0];
  const price = variant?.discount_price ?? variant?.price ?? product.base_price;

  async function handleAddToCart() {
    if (!user) {
      navigate("/login");
      return;
    }
    if (!variantId) return;
    setStatus("adding");
    await addItem(variantId, quantity);
    setStatus("added");
    setTimeout(() => setStatus(null), 1500);
  }

  return (
    <div className="grid md:grid-cols-2 gap-8">
      <div className="aspect-square bg-gray-100 rounded-lg overflow-hidden">
        {image && <img src={image.url} alt={product.name} className="w-full h-full object-cover" />}
      </div>
      <div>
        <p className="text-sm text-gray-500">{product.stores?.name}</p>
        <h1 className="text-2xl font-bold mt-1">{product.name}</h1>
        <p className="text-xl font-semibold text-emerald-700 mt-2">{price.toFixed(2)} ETB</p>
        {product.description && <p className="text-gray-600 mt-4">{product.description}</p>}

        {product.product_variants.length > 1 && (
          <div className="mt-4">
            <p className="text-sm font-medium mb-1">Variant</p>
            <div className="flex gap-2 flex-wrap">
              {product.product_variants.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setVariantId(v.id)}
                  className={`px-3 py-1.5 rounded-md border text-sm ${
                    variantId === v.id ? "bg-emerald-600 text-white border-emerald-600" : "bg-white"
                  }`}
                >
                  {Object.values(v.attributes).join(" / ") || v.sku}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 flex items-center gap-3">
          <input
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
            className="w-20 border rounded-md px-2 py-1.5"
          />
          <button
            onClick={handleAddToCart}
            disabled={status === "adding"}
            className="bg-emerald-600 text-white px-5 py-2 rounded-md text-sm font-medium hover:bg-emerald-700 disabled:opacity-60"
          >
            {status === "added" ? "Added!" : "Add to cart"}
          </button>
        </div>
      </div>
    </div>
  );
}
