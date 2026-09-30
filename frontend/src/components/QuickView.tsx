import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { Button, LazyImage, Skeleton, formatCurrency, useTranslation } from "@tolo/ui";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { useCart } from "../lib/CartContext";
import { recordProductView } from "../lib/recentlyViewed";
import type { Product } from "../types";

const PRODUCT_SELECT = `
  id, merchant_id, store_id, category_id, name, slug, description, base_price, discount_price, status,
  product_variants ( id, sku, attributes, price, discount_price, is_default, customer_price:product_variants_customer_price,
    stock_status:variant_stock_status, stock_remaining:variant_stock_remaining ),
  product_images ( id, url, is_primary, variant_id )
`;

export interface QuickViewProps {
  slug: string;
  onClose: () => void;
}

/** Item 7: a lightweight product preview that opens over the current page
 * (Marketplace/BrowseShops/Favorites grid) instead of navigating away --
 * re-fetches by slug with the full variant-level pricing ProductDetail.tsx
 * itself needs (grid cards only carry one representative price), so
 * switching variants here shows real prices, not a stale/approximate one. */
export function QuickView({ slug, onClose }: QuickViewProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { addItem } = useCart();
  const navigate = useNavigate();
  const [product, setProduct] = useState<Product | null>(null);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "adding" | "added">("idle");
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setProduct(null);
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
        if (p) recordProductView(p.id);
      });
  }, [slug]);

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previouslyFocused.current?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const variant = product?.product_variants.find((v) => v.id === variantId);
  const image = product?.product_images.find((i) => i.variant_id === variantId) ?? product?.product_images.find((i) => i.is_primary) ?? product?.product_images[0];
  const outOfStock = variant?.stock_status === "out_of_stock";

  async function handleAddToCart() {
    if (!user) {
      navigate("/login");
      return;
    }
    if (!variantId) return;
    setStatus("adding");
    await addItem(variantId, 1);
    setStatus("added");
    setTimeout(() => setStatus("idle"), 1500);
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={product?.name ?? t("quickView.open")}
        className="relative w-full max-w-md bg-white dark:bg-navy-dark rounded-lg shadow-popover outline-none max-h-[90vh] overflow-y-auto"
      >
        <button onClick={onClose} aria-label={t("common.close")} className="absolute top-3 right-3 z-10 bg-white/90 dark:bg-navy-dark/90 rounded-full p-1.5 text-gray-500 hover:text-gray-800 dark:text-gray-300 dark:hover:text-white">
          <X className="w-4 h-4" />
        </button>

        {!product ? (
          <div className="p-4 space-y-3">
            <Skeleton className="aspect-square w-full" />
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        ) : (
          <div>
            <LazyImage src={image?.url} alt={product.name} aspect="aspect-square" />
            <div className="p-4">
              <h2 className="font-semibold text-lg dark:text-gray-100">{product.name}</h2>
              <p className="text-navy dark:text-navy-light font-bold text-xl mt-1">{variant ? formatCurrency(variant.customer_price) : "—"}</p>

              {product.product_variants.length > 1 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {product.product_variants.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setVariantId(v.id)}
                      disabled={v.stock_status === "out_of_stock"}
                      aria-pressed={v.id === variantId}
                      className={`text-xs px-2.5 py-1 rounded-md border disabled:opacity-40 ${
                        v.id === variantId ? "bg-navy text-white border-navy dark:bg-navy-light dark:border-navy-light" : "dark:border-white/20 dark:text-gray-200"
                      }`}
                    >
                      {Object.values(v.attributes ?? {}).join(" / ") || v.sku}
                    </button>
                  ))}
                </div>
              )}

              {outOfStock && <p className="text-sm font-medium text-red-600 dark:text-red-400 mt-3">Out of stock</p>}

              <div className="flex items-center gap-2 mt-4">
                <Button onClick={handleAddToCart} disabled={status === "adding" || outOfStock} className="flex-1">
                  {status === "added" ? "Added!" : status === "adding" ? t("common.saving") : "Add to cart"}
                </Button>
                <Link to={`/products/${product.slug}`} onClick={onClose}>
                  <Button variant="outline">{t("quickView.viewFullDetails")}</Button>
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
