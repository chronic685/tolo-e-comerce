// Shared merchant-rating display (Storefront.tsx, ProductDetail.tsx) —
// server-computed via merchants_avg_rating/merchants_review_count
// (migration 0045), never derived here. Renders nothing at all for a
// merchant with zero reviews yet, rather than a misleading "0.0 ★".
export function RatingBadge({ avgRating, reviewCount }: { avgRating: number | null; reviewCount: number }) {
  if (!reviewCount || avgRating == null) return null;
  return (
    <span className="text-xs text-gray-600">
      {avgRating.toFixed(1)} ★ ({reviewCount} review{reviewCount === 1 ? "" : "s"})
    </span>
  );
}
