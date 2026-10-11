import { type Backend, type BackendModule, type Env, backendFor, selectBackend } from "./backend";
import { type ToloClient, createToloClient } from "./client";
import { type TokenSource, createTokenSource } from "./token";

export * from "./backend";
export * from "./client";
export * from "./token";
export * from "./query";
export type { components, operations, paths } from "./schema";

export const DEFAULT_API_BASE_URL = "http://localhost:5080";

export interface ToloApi {
  /** The typed client for the C# API. */
  client: ToloClient;
  /** The one function that returns the bearer token (or null). */
  getAccessToken: TokenSource;
  baseUrl: string;
  /** Which backend serves a module (default "supabase"). */
  backendFor: (module: BackendModule) => Backend;
  /** Picks a module's adapter implementation by that switch. */
  select: <T>(module: BackendModule, implementations: { supabase: () => T; api: () => T }) => T;
}

/**
 * Each app calls this once with its Vite environment: createToloApi(import.meta.env).
 * VITE_API_BASE_URL is the API address (default http://localhost:5080); VITE_BACKEND_<MODULE> switches a module to the API.
 */
export function createToloApi(env: Env, options: { fetch?: typeof fetch; storage?: Pick<Storage, "getItem"> } = {}): ToloApi {
  const baseUrl = String(env.VITE_API_BASE_URL ?? "").trim() || DEFAULT_API_BASE_URL;
  const getAccessToken = createTokenSource(env, options.storage);
  return {
    client: createToloClient({ baseUrl, getToken: getAccessToken, fetch: options.fetch }),
    getAccessToken,
    baseUrl,
    backendFor: (module) => backendFor(env, module),
    select: (module, implementations) => selectBackend(env, module, implementations),
  };
}
