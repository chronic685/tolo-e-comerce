/** Where a development token is kept: paste one in the browser console with localStorage.setItem("tolo.dev_token", "<token>"). */
export const DEV_TOKEN_KEY = "tolo.dev_token";

export type TokenSource = () => string | null;

type StorageLike = Pick<Storage, "getItem">;

/**
 * The single place the bearer token comes from. For now: a development token from local storage, in development builds only. A production
 * build never reads local storage and sends no token, so nothing can be smuggled in. Real sign-in stays on Supabase until Tolo's token format
 * is known; when it is, only this function changes.
 */
export function createTokenSource(env: { DEV?: unknown }, storage: StorageLike | undefined = safeLocalStorage()): TokenSource {
  return () => {
    if (!env.DEV || !storage) return null;
    try {
      const token = storage.getItem(DEV_TOKEN_KEY)?.trim();
      return token ? token : null;
    } catch {
      return null;
    }
  };
}

function safeLocalStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
