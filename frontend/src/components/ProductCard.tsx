import { Link } from "react-router-dom";
import { Heart, Star } from "lucide-react";
import { LazyImage, formatCurrency } from "@tolo/ui";
import { useAuth } from "../lib/AuthContext";
import { useFavorites } from "../lib/FavoritesContext";
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
  const image = product.product_images.find((i) => i.is_primary) ?? product.product_images[0];
  const price = product.customer_price;
  const favorited = isFavorite(product.id);

  return (
    <div className={`block bg-white rounded-lg border hover:shadow-md transition-shadow overflow-hidden relative snap-start ${className ?? ""}`}>
      <Link to={`/products/${product.slug}`} className="block">
        <LazyImage src={image?.url} alt={product.name} />
      </Link>
      {enabled && user && (
        <button
          onClick={() => toggleFavorite(product.id)}
          aria-label={favorited ? "Remove from favorites" : "Add to favorites"}
          className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/90 shadow flex items-center justify-center"
        >
          <Heart className={`w-4 h-4 ${favorited ? "fill-current text-red-500" : "text-gray-400"}`} />
        </button>
      )}
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
        </Link>
      </div>
    </div>
  );
}
