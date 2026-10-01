import { Star } from "lucide-react";

// Shared merchant-rating display (Storefront.tsx, ProductDetail.tsx) —
// server-computed via merchants_avg_rating/merchants_review_count
// (migration 0045), never derived here. Renders nothing at all for a
// merchant with zero reviews yet, rather than a misleading "0.0 star" badge.
export function RatingBadge({ avgRating, reviewCount }: { avgRating: number | null; reviewCount: number }) {
  if (!reviewCount || avgRating == null) return null;
  return (
    <span className="text-xs text-gray-600 dark:text-gray-300 inline-flex items-center gap-0.5">
      <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
      {avgRating.toFixed(1)} ({reviewCount} review{reviewCount === 1 ? "" : "s"})
    </span>
  );
}
