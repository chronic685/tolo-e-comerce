export type Locale = "en" | "am";

export const LOCALES: Locale[] = ["en", "am"];

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  am: "አማርኛ",
};

export const LOCALE_STORAGE_KEY = "tolo_locale";

/** English is the authored source -- every entry is the string itself. */
export type EnglishStrings = Record<string, string>;

/**
 * Amharic entries carry a review status alongside the text (item 7: "mark
 * every machine-translated string ... so a human can review it"). Every
 * string in am.json today is `status: "machine_translated"` -- none of
 * this has been reviewed by a native/professional Amharic speaker. A
 * future human edit flips a specific key to `status: "reviewed"`; nothing
 * else about the shape or the lookup code needs to change.
 */
export type TranslationStatus = "machine_translated" | "reviewed";

export interface AmharicEntry {
  text: string;
  status: TranslationStatus;
}

export type AmharicStrings = Record<string, AmharicEntry>;
