// Per-table localStorage persistence for column visibility and saved
// filters. Namespaced by the caller's `storageKey` (e.g. "admin.orders") so
// two different tables never collide. Every read/write is best-effort with
// the same try/catch shape as i18n/detectLocale.ts -- a private window or
// blocked site data means preferences don't survive a reload, not a broken
// table.

export interface SavedFilter {
  name: string;
  query: string;
  sortKey: string | null;
  sortDirection: "asc" | "desc";
  hiddenColumns: string[];
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Best-effort -- see module doc comment.
  }
}

const hiddenColumnsKey = (storageKey: string) => `tolo_table_${storageKey}_hidden_columns`;
const savedFiltersKey = (storageKey: string) => `tolo_table_${storageKey}_saved_filters`;

export function loadHiddenColumns(storageKey: string): string[] {
  return readJson(hiddenColumnsKey(storageKey), []);
}

export function persistHiddenColumns(storageKey: string, hidden: string[]): void {
  writeJson(hiddenColumnsKey(storageKey), hidden);
}

export function loadSavedFilters(storageKey: string): SavedFilter[] {
  return readJson(savedFiltersKey(storageKey), []);
}

export function persistSavedFilters(storageKey: string, filters: SavedFilter[]): void {
  writeJson(savedFiltersKey(storageKey), filters);
}

export function upsertSavedFilter(storageKey: string, filter: SavedFilter): SavedFilter[] {
  const existing = loadSavedFilters(storageKey).filter((f) => f.name !== filter.name);
  const next = [...existing, filter];
  persistSavedFilters(storageKey, next);
  return next;
}

export function removeSavedFilter(storageKey: string, name: string): SavedFilter[] {
  const next = loadSavedFilters(storageKey).filter((f) => f.name !== name);
  persistSavedFilters(storageKey, next);
  return next;
}
