import { createToloApi } from "@tolo/api-client";

/**
 * The new C# API (https://github.com/chronic685/tolo-marketplace-api) and the per-module backend switches.
 * Screens do not use this directly: each module has an adapter that picks Supabase or the API with toloApi.select(...).
 * See packages/api-client/README.md.
 */
export const toloApi = createToloApi(import.meta.env);
