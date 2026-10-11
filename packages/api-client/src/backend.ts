/**
 * Which backend serves a module. The migration to the C# API is done one module at a time: every module has a switch,
 * VITE_BACKEND_<MODULE>=supabase|api, and anything that is not exactly "api" means supabase. Supabase stays the default until cut-over.
 */
export const BACKEND_MODULES = [
  "catalogue",
  "merchant-products",
  "orders",
  "merchant-orders",
  "admin",
  "finance",
  "content",
] as const;

export type BackendModule = (typeof BACKEND_MODULES)[number];
export type Backend = "supabase" | "api";

export type Env = Record<string, unknown>;

/** The environment variable that switches a module: "merchant-products" is VITE_BACKEND_MERCHANT_PRODUCTS. */
export function backendEnvName(module: BackendModule): string {
  return `VITE_BACKEND_${module.toUpperCase().replace(/-/g, "_")}`;
}

export function backendFor(env: Env, module: BackendModule): Backend {
  return String(env[backendEnvName(module)] ?? "").trim().toLowerCase() === "api" ? "api" : "supabase";
}

/**
 * The adapter seam. A module defines one interface (what its screens need), one implementation per backend, and picks one here,
 * so screens import the adapter and never know which backend answers. Only the chosen implementation is built.
 */
export function selectBackend<T>(env: Env, module: BackendModule, implementations: { supabase: () => T; api: () => T }): T {
  return implementations[backendFor(env, module)]();
}
