import { Link } from "react-router-dom";
import type { Product } from "../types";

export function ProductCard({ product }: { product: Product }) {
  const image = product.product_images.find((i) => i.is_primary) ?? product.product_images[0];
  const price = product.customer_price;

  return (
    <Link
      to={`/products/${product.slug}`}
      className="block bg-white rounded-lg border hover:shadow-md transition-shadow overflow-hidden"
    >
      <div className="aspect-square bg-gray-100">
        {image && <img src={image.url} alt={product.name} className="w-full h-full object-cover" />}
      </div>
      <div className="p-3">
        <p className="text-xs text-gray-500">{product.stores?.name}</p>
        <h3 className="font-medium text-sm truncate">{product.name}</h3>
        <div className="mt-1">
          <span className="font-semibold text-navy">{price.toFixed(2)} ETB</span>
        </div>
      </div>
    </Link>
  );
}
