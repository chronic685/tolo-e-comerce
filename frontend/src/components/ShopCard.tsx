import { Link } from "react-router-dom";
import { Star } from "lucide-react";
import { LazyImage } from "@tolo/ui";

export interface ShopCardProps {
  slug: string;
  name: string;
  photoUrl: string | null;
  subtitle: string;
  avgRating?: number | null;
  reviewCount?: number;
  className?: string;
}

/** Presentational shop card shared by the Home page's shop row and the
 * Shops browse grid — callers resolve the photo/subtitle/rating data. */
export function ShopCard({ slug, name, photoUrl, subtitle, avgRating, reviewCount, className }: ShopCardProps) {
  return (
    <Link
      to={`/stores/${slug}`}
      className={`block bg-white rounded-lg border hover:shadow-md transition-shadow overflow-hidden ${className ?? ""}`}
    >
      <LazyImage src={photoUrl} alt={name} />
      <div className="p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium text-sm truncate">{name}</p>
          {avgRating != null && (reviewCount ?? 0) > 0 && (
            <span className="flex items-center gap-0.5 text-xs text-gray-500 flex-shrink-0">
              <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
              {avgRating.toFixed(1)}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 line-clamp-2 mt-0.5">{subtitle}</p>
      </div>
    </Link>
  );
}
