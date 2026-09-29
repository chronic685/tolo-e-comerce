import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { detectInitialLocale, persistLocale } from "./detectLocale";
import { resolveString } from "./loadTranslations";
import { setCurrentLocale } from "./locale";
import type { Locale } from "./types";

export interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

export const I18nContext = createContext<I18nContextValue | undefined>(undefined);

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
}

/** Wraps each app's root exactly once (App.tsx / main.tsx) -- see
 * docs/i18n.md. Keeps `locale` in React state (so components re-render on
 * a change) and mirrors every change into the plain module-level
 * lib/format.ts singleton (see i18n/locale.ts) so non-component helpers
 * stay in sync without prop-drilling. */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => detectInitialLocale());

  useEffect(() => {
    setCurrentLocale(locale);
    persistLocale(locale);
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => interpolate(resolveString(locale, key), vars),
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
