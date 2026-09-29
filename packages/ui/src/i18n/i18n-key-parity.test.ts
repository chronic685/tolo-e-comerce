import { describe, expect, it } from "vitest";
import { getAmharicStrings, getEnglishStrings } from "./loadTranslations";

// Group 5, item 8: "a script that fails CI if any key exists in en but
// not in am (or the reverse)". en.ts is the authored source and am.ts is
// meant to carry the exact same key set -- a mismatch either means a new
// English string was never translated, or a stale Amharic key is dead
// weight nothing ever looks up.
describe("i18n locale key parity (en.ts <-> am.ts)", () => {
  it("every English key has a matching Amharic key", () => {
    const en = getEnglishStrings();
    const am = getAmharicStrings();
    const missingFromAmharic = Object.keys(en).filter((key) => !(key in am));
    expect(missingFromAmharic, `Keys missing from am.ts: ${missingFromAmharic.join(", ")}`).toEqual([]);
  });

  it("every Amharic key has a matching English key", () => {
    const en = getEnglishStrings();
    const am = getAmharicStrings();
    const staleInAmharic = Object.keys(am).filter((key) => !(key in en));
    expect(staleInAmharic, `Keys in am.ts with no English counterpart: ${staleInAmharic.join(", ")}`).toEqual([]);
  });

  it("no English string is empty", () => {
    const en = getEnglishStrings();
    const empty = Object.entries(en)
      .filter(([, value]) => !value || !value.trim())
      .map(([key]) => key);
    expect(empty, `Empty English strings: ${empty.join(", ")}`).toEqual([]);
  });

  it("every Amharic entry has real text and a recognized review status", () => {
    const am = getAmharicStrings();
    const bad = Object.entries(am)
      .filter(([, entry]) => !entry.text?.trim() || !["machine_translated", "reviewed"].includes(entry.status))
      .map(([key]) => key);
    expect(bad, `Malformed Amharic entries: ${bad.join(", ")}`).toEqual([]);
  });

  it("interpolation placeholders match between an English string and its Amharic counterpart", () => {
    const en = getEnglishStrings();
    const am = getAmharicStrings();
    const placeholderPattern = /\{\{(\w+)\}\}/g;
    const mismatched: string[] = [];
    for (const [key, englishText] of Object.entries(en)) {
      const amharicEntry = am[key];
      if (!amharicEntry) continue;
      const englishPlaceholders = [...englishText.matchAll(placeholderPattern)].map((m) => m[1]).sort();
      const amharicPlaceholders = [...amharicEntry.text.matchAll(placeholderPattern)].map((m) => m[1]).sort();
      if (JSON.stringify(englishPlaceholders) !== JSON.stringify(amharicPlaceholders)) {
        mismatched.push(key);
      }
    }
    expect(mismatched, `Placeholder mismatch between en/am for: ${mismatched.join(", ")}`).toEqual([]);
  });
});
