import { supabase } from "../../lib/supabase";
import { toloApi } from "../../lib/api";
import { createApiCatalogue } from "./api";
import { createSupabaseCatalogue } from "./supabase";
import type { CatalogueBackend } from "./types";

export type * from "./types";

/**
 * The customer catalogue (categories, shops, products, search, price filters). VITE_BACKEND_CATALOGUE=supabase|api picks the backend (default
 * supabase); screens use this and never know which one answers.
 */
export const catalogue: CatalogueBackend = toloApi.select("catalogue", {
  supabase: () => createSupabaseCatalogue(supabase),
  api: () => createApiCatalogue(toloApi.client),
});
