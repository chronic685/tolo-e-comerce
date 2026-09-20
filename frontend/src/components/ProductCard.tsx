import { Link } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { useFavorites } from "../lib/FavoritesContext";
import type { Product } from "../types";

export function ProductCard({ product }: { product: Product }) {
  const { user } = useAuth();
  const { enabled, isFavorite, toggleFavorite } = useFavorites();
  const image = product.product_images.find((i) => i.is_primary) ?? product.product_images[0];
  const price = product.customer_price;
  const favorited = isFavorite(product.id);

  return (
    <div className="block bg-white rounded-lg border hover:shadow-md transition-shadow overflow-hidden relative">
      <Link to={`/products/${product.slug}`} className="block">
        <div className="aspect-square bg-gray-100">
          {image && <img src={image.url} alt={product.name} className="w-full h-full object-cover" />}
        </div>
      </Link>
      {enabled && user && (
        <button
          onClick={() => toggleFavorite(product.id)}
          aria-label={favorited ? "Remove from favorites" : "Add to favorites"}
          className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/90 shadow flex items-center justify-center text-lg"
        >
          {favorited ? "❤️" : "🤍"}
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
          <div className="mt-1">
            <span className="font-semibold text-navy">{price.toFixed(2)} ETB</span>
          </div>
        </Link>
      </div>
    </div>
  );
}
