import { supabase } from "../../lib/supabase";
import { toloApi } from "../../lib/api";
import { createApiMerchantProducts } from "./api";
import { createSupabaseMerchantProducts } from "./supabase";
import type { MerchantProductsBackend } from "./types";

export type * from "./types";

/**
 * The merchant's product management (list, hide/show, archive/restore, delete, edit with variants and pictures).
 * VITE_BACKEND_MERCHANT_PRODUCTS=supabase|api picks the backend (default supabase); screens use this and never know which one answers.
 */
export const merchantProducts: MerchantProductsBackend = toloApi.select("merchant-products", {
  supabase: () => createSupabaseMerchantProducts(supabase),
  api: () => createApiMerchantProducts({ client: toloApi.client, baseUrl: toloApi.baseUrl, getToken: toloApi.getAccessToken }),
});
