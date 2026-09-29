import { LOCALE_STORAGE_KEY, type Locale } from "./types";

/** Item 2: "Default: the browser language if it is Amharic, otherwise
 * English." A stored choice always wins over the browser default -- once
 * someone has explicitly picked a language, re-detecting on every visit
 * would silently override it if they ever travel or change their OS/
 * browser locale. */
export function detectInitialLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored === "en" || stored === "am") return stored;
  } catch {
    // localStorage can throw in a private window / with site data blocked
    // -- fall through to browser detection, same as every other
    // best-effort localStorage read in this codebase.
  }

  const browserLanguages = typeof navigator !== "undefined" ? navigator.languages ?? [navigator.language] : [];
  const isAmharic = browserLanguages.some((lang) => lang?.toLowerCase().startsWith("am"));
  return isAmharic ? "am" : "en";
}

export function persistLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Best-effort -- a private window or blocked site data just means the
    // choice doesn't survive a reload, not a broken app.
  }
}
