// Item 7: "recently viewed row." Plain localStorage list of product ids,
// most-recent-first, capped so it stays a quick glance rather than a second
// order history. Best-effort try/catch, same shape as every other persisted
// preference in this codebase (packages/ui/src/i18n/detectLocale.ts).
const STORAGE_KEY = "tolo_recently_viewed";
const MAX_ENTRIES = 12;

export function getRecentlyViewedIds(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** Moves `productId` to the front, de-duplicating any earlier appearance,
 * and trims to MAX_ENTRIES. */
export function recordProductView(productId: string): string[] {
  const next = [productId, ...getRecentlyViewedIds().filter((id) => id !== productId)].slice(0, MAX_ENTRIES);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Best-effort -- a private window or blocked site data just means the
    // row doesn't persist, not a broken page.
  }
  return next;
}
