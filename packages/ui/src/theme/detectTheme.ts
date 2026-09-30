import { THEME_STORAGE_KEY, type ThemeMode } from "./types";

/** Same precedence as i18n/detectLocale.ts: an explicit stored choice
 * always wins over the OS preference -- once someone has picked a theme by
 * hand, re-detecting prefers-color-scheme on every visit would silently
 * override it if they change their OS theme for an unrelated reason. */
export function detectInitialTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // localStorage can throw in a private window / with site data blocked
    // -- fall through to the OS preference, same as every other
    // best-effort localStorage read in this codebase.
  }

  const prefersDark = typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
}

export function persistTheme(theme: ThemeMode): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Best-effort -- a private window or blocked site data just means the
    // choice doesn't survive a reload, not a broken app.
  }
}
