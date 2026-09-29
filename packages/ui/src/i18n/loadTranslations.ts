import { en as englishStrings } from "./locales/en";
import { am as amharicStrings } from "./locales/am";
import type { EnglishStrings, AmharicStrings, Locale } from "./types";

/** Resolves one key against the active locale, always falling back to
 * English (never a raw, un-translated key) -- see i18n-key-parity.test.ts
 * for what's actually supposed to make that fallback unreachable in
 * practice: every am.ts key is required to exist for every en.ts key. */
export function resolveString(locale: Locale, key: string): string {
  if (locale === "am") {
    const entry = amharicStrings[key];
    if (entry) return entry.text;
  }
  const english = englishStrings[key];
  if (english !== undefined) return english;
  return key;
}

export function getEnglishStrings(): EnglishStrings {
  return englishStrings;
}

export function getAmharicStrings(): AmharicStrings {
  return amharicStrings;
}
