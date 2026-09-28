import { supabase } from "./supabase";
import type { MerchantRating } from "../types";

/** One batched query for every distinct merchant on a page (product grid,
 * shop grid) — never fetch a merchant's rating aggregate once per card,
 * matching the same avoid-N+1 pattern already used for shop product
 * summaries (see BrowseShops.tsx). */
export async function fetchMerchantRatings(merchantIds: string[]): Promise<Map<string, MerchantRating>> {
  const uniqueIds = [...new Set(merchantIds)];
  const ratings = new Map<string, MerchantRating>();
  if (uniqueIds.length === 0) return ratings;

  const { data } = await supabase
    .from("merchants")
    .select("id, avg_rating:merchants_avg_rating, review_count:merchants_review_count")
    .in("id", uniqueIds);

  for (const row of data ?? []) {
    ratings.set(row.id, { avg_rating: row.avg_rating, review_count: row.review_count ?? 0 });
  }
  return ratings;
}
