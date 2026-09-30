export interface FilterableColumn<T> {
  key: string;
  filterValue?: (row: T) => string;
  csvValue?: (row: T) => string | number | null;
}

export interface SortableColumn<T> {
  key: string;
  sortValue?: (row: T) => string | number | null;
}

/** A row matches if ANY visible, filterable column's text contains the
 * query (case-insensitive) -- same "search across every shown field" model
 * as a spreadsheet's quick filter, not a per-column AND. */
export function filterRows<T>(rows: T[], columns: FilterableColumn<T>[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) =>
    columns.some((col) => {
      const value = col.filterValue ? col.filterValue(row) : (col.csvValue?.(row) ?? "");
      return String(value ?? "").toLowerCase().includes(q);
    }),
  );
}

export type SortDirection = "asc" | "desc";

/** Stable sort (rows with no sortValue, or equal values, keep their
 * original relative order) -- Array.prototype.sort is spec-guaranteed
 * stable since ES2019, which every browser/runtime this repo targets has. */
export function sortRows<T>(rows: T[], columns: SortableColumn<T>[], sortKey: string | null, direction: SortDirection): T[] {
  if (!sortKey) return rows;
  const column = columns.find((c) => c.key === sortKey);
  if (!column?.sortValue) return rows;

  const withValues = rows.map((row) => ({ row, value: column.sortValue!(row) }));
  withValues.sort((a, b) => {
    if (a.value == null && b.value == null) return 0;
    if (a.value == null) return 1;
    if (b.value == null) return -1;
    if (typeof a.value === "number" && typeof b.value === "number") return a.value - b.value;
    return String(a.value).localeCompare(String(b.value));
  });
  const sorted = withValues.map((w) => w.row);
  return direction === "asc" ? sorted : sorted.reverse();
}
