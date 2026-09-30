import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { detectInitialTheme, persistTheme } from "./detectTheme";
import type { ThemeMode } from "./types";

export interface ThemeContextValue {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
}

export const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

/** Wraps each app's root exactly once (main.tsx), alongside I18nProvider --
 * see packages/ui/src/i18n/I18nProvider.tsx, whose persisted-choice-wins
 * pattern this mirrors. Toggles a `.dark` class on <html>, which theme.css's
 * `@custom-variant dark (&:where(.dark, .dark *))` is what every `dark:`
 * Tailwind utility in the three apps actually keys off. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(() => detectInitialTheme());

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    // A plain color-scheme hint so native form controls (checkboxes,
    // scrollbars, date pickers) also render dark instead of fighting the
    // rest of the page with a bright default chrome.
    document.documentElement.style.colorScheme = theme;
    persistTheme(theme);
  }, [theme]);

  const setTheme = useCallback((next: ThemeMode) => {
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
