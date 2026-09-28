import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Minus, Plus, ShoppingCart, Store, Trash2 } from "lucide-react";
import { Button, Card, CardContent, EmptyState, formatCurrency, LazyImage, SkeletonRows } from "@tolo/ui";
import { supabase } from "../lib/supabase";
import { useCart } from "../lib/CartContext";

export function Cart() {
  const { items, loading, updateQuantity, removeItem } = useCart();
  const navigate = useNavigate();

  // Cart items only carry merchant_id (see CartContext.tsx's CART_ITEM_SELECT),
  // not the shop's display name — one small batched lookup, keyed off the
  // distinct merchant ids currently in the cart, gets a "Shop name" heading
  // per group instead of a generic one.
  const [storeNames, setStoreNames] = useState<Map<string, string>>(new Map());
  const merchantIds = useMemo(
    () => Array.from(new Set(items.map((item) => item.product_variants.products.merchant_id))).sort(),
    [items],
  );
  const merchantIdsKey = merchantIds.join(",");

  useEffect(() => {
    if (merchantIds.length === 0) return;
    supabase
      .from("stores")
      .select("merchant_id, name")
      .in("merchant_id", merchantIds)
      .then(({ data }) => {
        setStoreNames(new Map((data ?? []).map((s) => [s.merchant_id, s.name] as const)));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchantIdsKey]);

  const groups = useMemo(() => {
    const map = new Map<string, typeof items>();
    for (const item of items) {
      const merchantId = item.product_variants.products.merchant_id;
      const existing = map.get(merchantId);
      if (existing) existing.push(item);
      else map.set(merchantId, [item]);
    }
    return map;
  }, [items]);

  const total = items.reduce((sum, item) => sum + item.product_variants.customer_price * item.quantity, 0);

  if (loading) return <SkeletonRows count={3} />;

  if (items.length === 0) {
    return (
      <EmptyState
        icon={ShoppingCart}
        title="Your cart is empty"
        description="Add items from the marketplace to get started."
        action={<Button onClick={() => navigate("/")}>Browse the marketplace</Button>}
      />
    );
  }

  return (
    <div className="grid md:grid-cols-3 gap-8">
      <div className="md:col-span-2 space-y-6">
        {[...groups.entries()].map(([merchantId, groupItems]) => (
          <div key={merchantId}>
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-500 mb-2">
              <Store className="w-4 h-4" />
              {storeNames.get(merchantId) ?? "Shop"}
            </h2>
            <div className="space-y-3">
              {groupItems.map((item) => {
                const price = item.product_variants.customer_price;
                const attrs = Object.values(item.product_variants.attributes ?? {}).join(" / ");
                const images = item.product_variants.products.product_images ?? [];
                const image = images.find((i) => i.is_primary) ?? images[0];
                return (
                  <Card key={item.id} className="p-4 flex items-center gap-4">
                    <LazyImage
                      src={image?.url}
                      alt={item.product_variants.products.name}
                      className="w-16 h-16 rounded-md flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <Link
                        to={`/products/${item.product_variants.products.slug}`}
                        className="font-medium hover:text-navy truncate block"
                      >
                        {item.product_variants.products.name}
                      </Link>
                      {attrs && <p className="text-xs text-gray-500">{attrs}</p>}
                      <p className="text-sm text-navy font-semibold mt-1">{formatCurrency(price)}</p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.id, item.quantity - 1)}
                        aria-label="Decrease quantity"
                        className="w-8 h-8 rounded-md border flex items-center justify-center text-gray-600 hover:bg-gray-50"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="w-6 text-center text-sm font-medium">{item.quantity}</span>
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.id, item.quantity + 1)}
                        aria-label="Increase quantity"
                        className="w-8 h-8 rounded-md border flex items-center justify-center text-gray-600 hover:bg-gray-50"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeItem(item.id)}
                      aria-label="Remove item"
                      className="text-gray-400 hover:text-red-600 flex-shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </Card>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <Card className="h-fit">
        <CardContent>
          <div className="flex justify-between font-semibold text-lg mb-1">
            <span>Subtotal</span>
            <span>{formatCurrency(total)}</span>
          </div>
          <p className="text-xs text-gray-400 mb-4">Delivery fee isn't included yet — it's calculated at checkout.</p>
          <Button onClick={() => navigate("/checkout")} className="w-full">
            Proceed to checkout
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
