import { useState } from "react";
import { Link } from "react-router-dom";
import { Eye, Heart, Star } from "lucide-react";
import { LazyImage, formatCurrency, useTranslation } from "@tolo/ui";
import { useAuth } from "../lib/AuthContext";
import { useFavorites } from "../lib/FavoritesContext";
import { QuickView } from "./QuickView";
import type { MerchantRating, Product } from "../types";

export interface ProductCardProps {
  product: Product;
  /** Batched merchant rating (see lib/merchantRatings.ts) — never fetched
   * per-card, so callers resolve and pass it in. */
  rating?: MerchantRating | null;
  /** Fixed width for use inside a horizontally-scrolling row; omit for a grid cell. */
  className?: string;
}

export function ProductCard({ product, rating, className }: ProductCardProps) {
  const { user } = useAuth();
  const { enabled, isFavorite, toggleFavorite } = useFavorites();
  const { t } = useTranslation();
  const [quickViewOpen, setQuickViewOpen] = useState(false);
  const image = product.product_images.find((i) => i.is_primary) ?? product.product_images[0];
  const price = product.customer_price;
  const favorited = isFavorite(product.id);
  // The default variant's availability represents the whole card -- a
  // product with multiple variants shows each one's own status on its
  // detail page instead.
  const defaultVariant = product.product_variants.find((v) => v.is_default) ?? product.product_variants[0];

  return (
    <div
      className={`group block bg-white dark:bg-navy-dark rounded-lg border dark:border-white/10 hover:shadow-md transition-shadow overflow-hidden relative snap-start ${className ?? ""}`}
    >
      <Link to={`/products/${product.slug}`} className="block">
        <LazyImage src={image?.url} alt={product.name} />
      </Link>
      <button
        onClick={() => setQuickViewOpen(true)}
        aria-label={t("quickView.open")}
        className="absolute top-2 left-2 w-8 h-8 rounded-full bg-white/90 dark:bg-navy-dark/90 shadow flex items-center justify-center opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
      >
        <Eye className="w-4 h-4 text-gray-600 dark:text-gray-300" />
      </button>
      {enabled && user && (
        <button
          onClick={() => toggleFavorite(product.id)}
          aria-label={favorited ? t("productDetail.removeFromFavorites") : t("productDetail.addToFavorites")}
          className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/90 dark:bg-navy-dark/90 shadow flex items-center justify-center"
        >
          <Heart className={`w-4 h-4 ${favorited ? "fill-current text-red-500" : "text-gray-400"}`} />
        </button>
      )}
      {quickViewOpen && <QuickView slug={product.slug} onClose={() => setQuickViewOpen(false)} />}
      <div className="p-3">
        {/* A store-name link sitting inside the whole-card link would be
            invalid nested anchors, so the card is a plain div with two
            sibling links instead — one to the store, one to the product. */}
        {product.stores && (
          <Link to={`/stores/${product.stores.slug}`} className="text-xs text-gray-500 hover:text-navy hover:underline">
            {product.stores.name}
          </Link>
        )}
        <Link to={`/products/${product.slug}`} className="block">
          <h3 className="font-medium text-sm truncate">{product.name}</h3>
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="font-semibold text-navy">{formatCurrency(price)}</span>
            {rating?.avg_rating != null && rating.review_count > 0 && (
              <span className="flex items-center gap-0.5 text-xs text-gray-500 flex-shrink-0">
                <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                {rating.avg_rating.toFixed(1)}
              </span>
            )}
          </div>
          {(defaultVariant?.stock_status === "out_of_stock" || product.in_stock === false) && (
            <p className="text-xs font-medium text-red-600 mt-0.5">{t("productDetail.outOfStock")}</p>
          )}
          {defaultVariant?.stock_status === "low" && defaultVariant.stock_remaining != null && (
            <p className="text-xs font-medium text-orange-600 mt-0.5">{t("productCard.onlyLeft", { count: defaultVariant.stock_remaining })}</p>
          )}
        </Link>
      </div>
    </div>
  );
}
