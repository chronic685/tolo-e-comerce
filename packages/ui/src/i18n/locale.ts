import type { Locale } from "./types";

// A plain module-level value, not React state -- lib/format.ts's
// formatCurrency/formatDate/etc. are called from lots of places that
// aren't components (CSV export row-mapping, non-hook helper functions)
// and have no sane way to receive a `locale` prop. I18nProvider is the
// only writer (on mount and on every setLocale), so this always reflects
// whatever the app's current language actually is; anything that needs to
// re-render on a change should go through useTranslation()'s own React
// state, not this.
let currentLocale: Locale = "en";
const listeners = new Set<(locale: Locale) => void>();

export function getCurrentLocale(): Locale {
  return currentLocale;
}

export function setCurrentLocale(locale: Locale): void {
  currentLocale = locale;
  for (const listener of listeners) listener(locale);
}

export function subscribeToLocale(listener: (locale: Locale) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
