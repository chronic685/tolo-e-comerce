import { catalogue } from "../data/catalogue";
import type { MerchantRating } from "../types";

/** One batched lookup for every distinct merchant on a page (product grid, shop grid) -- never once per card. The backend behind it
 * (Supabase or the API) is the catalogue adapter's business. */
export function fetchMerchantRatings(merchantIds: string[]): Promise<Map<string, MerchantRating>> {
  return catalogue.getMerchantRatings(merchantIds);
}
