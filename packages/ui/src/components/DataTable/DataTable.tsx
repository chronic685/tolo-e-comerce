import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3, Download, Trash2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "../Button";
import { Input } from "../Input";
import { exportToCsv } from "../../lib/csv";
import { useTranslation } from "../../i18n/useTranslation";
import { cn } from "../../lib/cn";
import { filterRows, sortRows, type SortDirection } from "./filterSort";
import { loadHiddenColumns, loadSavedFilters, persistHiddenColumns, removeSavedFilter, upsertSavedFilter, type SavedFilter } from "./tablePrefs";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Plain-text value for CSV export and the free-text filter. Required for
   * a column to participate in either -- a column that's purely visual
   * (e.g. a status dot) can omit it and stay display-only. */
  csvValue?: (row: T) => string | number | null;
  filterValue?: (row: T) => string;
  sortValue?: (row: T) => string | number | null;
  align?: "left" | "right";
  hideByDefault?: boolean;
}

export interface DataTableBulkAction<T> {
  label: string;
  icon?: LucideIcon;
  variant?: "default" | "outline" | "destructive";
  onAction: (selectedRows: T[]) => void | Promise<void>;
}

export interface DataTableProps<T> {
  /** Namespaces this table's saved filters/column visibility in
   * localStorage -- must be unique per table on the page (e.g. "admin.orders"). */
  storageKey: string;
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  bulkActions?: DataTableBulkAction<T>[];
  /** Filename for a CSV of the currently filtered+sorted `rows` as loaded
   * (not the whole server-side result set -- for that, pass onExportAll
   * instead, e.g. built on fetchAllRows the same way ExportCsvButton
   * elsewhere in this codebase already is). */
  csvFilename?: string;
  onExportAll?: () => void | Promise<void>;
  emptyMessage?: string;
  className?: string;
}

function useOutsideClick(onOutside: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onOutside]);
  return ref;
}

/** Client-side sort/filter/select/column-visibility/saved-filters/CSV-export
 * table, with a sticky header on desktop and a stacked card layout below
 * `md` -- built once so admin/merchant list pages don't each hand-roll their
 * own bespoke version of the same six behaviors. Operates on whatever `rows`
 * the caller already has loaded (a page's worth, or a full set); it does not
 * fetch anything itself. */
export function DataTable<T>({
  storageKey,
  columns,
  rows,
  getRowId,
  bulkActions,
  csvFilename,
  onExportAll,
  emptyMessage,
  className,
}: DataTableProps<T>) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(
    () => new Set(loadHiddenColumns(storageKey).length ? loadHiddenColumns(storageKey) : columns.filter((c) => c.hideByDefault).map((c) => c.key)),
  );
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>(() => loadSavedFilters(storageKey));
  const [savedFiltersOpen, setSavedFiltersOpen] = useState(false);

  const columnsMenuRef = useOutsideClick(() => setColumnsMenuOpen(false));
  const savedFiltersRef = useOutsideClick(() => setSavedFiltersOpen(false));

  const visibleColumns = useMemo(() => columns.filter((c) => !hiddenColumns.has(c.key)), [columns, hiddenColumns]);

  const filtered = useMemo(() => filterRows(rows, columns, query), [rows, columns, query]);
  const sorted = useMemo(() => sortRows(filtered, columns, sortKey, sortDirection), [filtered, columns, sortKey, sortDirection]);

  function toggleColumn(key: string) {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      persistHiddenColumns(storageKey, [...next]);
      return next;
    });
  }

  function toggleSort(key: string) {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDirection("asc");
    } else if (sortDirection === "asc") {
      setSortDirection("desc");
    } else {
      setSortKey(null);
    }
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === sorted.length ? new Set() : new Set(sorted.map(getRowId))));
  }

  const selectedRows = sorted.filter((row) => selected.has(getRowId(row)));

  function handleExportVisible() {
    if (!csvFilename) return;
    const exportColumns = columns.filter((c) => c.csvValue);
    exportToCsv(
      csvFilename,
      sorted.map((row) => Object.fromEntries(exportColumns.map((c) => [c.header, c.csvValue!(row) ?? ""]))),
    );
  }

  function applySavedFilter(filter: SavedFilter) {
    setQuery(filter.query);
    setSortKey(filter.sortKey);
    setSortDirection(filter.sortDirection);
    setHiddenColumns(new Set(filter.hiddenColumns));
    persistHiddenColumns(storageKey, filter.hiddenColumns);
    setSavedFiltersOpen(false);
  }

  function saveCurrentFilter() {
    // Auto Mode: this is the one interactive part of DataTable that needs a
    // short free-text name from the person using it right now -- a modal
    // text field would be more polished but window.prompt keeps this table
    // a drop-in component with no extra Sheet wiring per caller.
    const name = window.prompt(t("dataTable.filterNamePrompt"));
    if (!name) return;
    const filter: SavedFilter = { name, query, sortKey, sortDirection, hiddenColumns: [...hiddenColumns] };
    setSavedFilters(upsertSavedFilter(storageKey, filter));
  }

  function deleteSavedFilter(name: string) {
    setSavedFilters(removeSavedFilter(storageKey, name));
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("dataTable.searchPlaceholder")}
          aria-label={t("dataTable.searchPlaceholder")}
          className="max-w-xs"
        />

        <div className="relative" ref={savedFiltersRef}>
          <Button type="button" variant="outline" size="sm" onClick={() => setSavedFiltersOpen((o) => !o)} aria-expanded={savedFiltersOpen}>
            {t("dataTable.savedFilters")}
          </Button>
          {savedFiltersOpen && (
            <div className="absolute z-20 mt-1 w-56 rounded-md border bg-white dark:bg-navy-dark dark:border-white/10 shadow-popover p-1.5">
              {savedFilters.length === 0 && <p className="text-xs text-gray-400 px-2 py-1.5">{t("dataTable.noRows")}</p>}
              {savedFilters.map((f) => (
                <div key={f.name} className="flex items-center justify-between gap-1 rounded px-2 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-white/5">
                  <button type="button" className="flex-1 text-left truncate dark:text-gray-200" onClick={() => applySavedFilter(f)}>
                    {f.name}
                  </button>
                  <button
                    type="button"
                    aria-label={`${t("dataTable.deleteFilter")}: ${f.name}`}
                    className="text-gray-400 hover:text-red-600 dark:hover:text-red-400 flex-shrink-0"
                    onClick={() => deleteSavedFilter(f.name)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={saveCurrentFilter}
                className="w-full text-left px-2 py-1.5 text-sm text-navy dark:text-navy-light hover:bg-navy-50 dark:hover:bg-white/5 rounded"
              >
                {t("dataTable.saveCurrentFilter")}
              </button>
            </div>
          )}
        </div>

        <div className="relative" ref={columnsMenuRef}>
          <Button type="button" variant="outline" size="sm" onClick={() => setColumnsMenuOpen((o) => !o)} aria-expanded={columnsMenuOpen}>
            <Columns3 className="w-3.5 h-3.5" />
            {t("dataTable.columns")}
          </Button>
          {columnsMenuOpen && (
            <div className="absolute z-20 mt-1 w-52 rounded-md border bg-white dark:bg-navy-dark dark:border-white/10 shadow-popover p-1.5">
              {columns.map((col) => (
                <label key={col.key} className="flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-gray-50 dark:hover:bg-white/5 dark:text-gray-200">
                  <input
                    type="checkbox"
                    checked={!hiddenColumns.has(col.key)}
                    onChange={() => toggleColumn(col.key)}
                    className="accent-navy"
                  />
                  {col.header}
                </label>
              ))}
            </div>
          )}
        </div>

        {csvFilename && (
          <Button type="button" variant="outline" size="sm" onClick={handleExportVisible}>
            <Download className="w-3.5 h-3.5" />
            {t("common.exportCsv")}
          </Button>
        )}
        {onExportAll && (
          <Button type="button" variant="outline" size="sm" onClick={() => void onExportAll()}>
            <Download className="w-3.5 h-3.5" />
            {t("common.exportCsv")}
          </Button>
        )}
      </div>

      {selected.size > 0 && bulkActions && bulkActions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-navy-50 dark:border-navy-light/30 bg-navy-50 dark:bg-navy-light/10 px-3 py-2">
          <span className="text-sm font-medium text-navy dark:text-navy-light">{t("dataTable.selectedCount", { count: selected.size })}</span>
          <button type="button" onClick={() => setSelected(new Set())} className="text-xs text-navy/70 dark:text-navy-light/70 hover:underline">
            {t("dataTable.clearSelection")}
          </button>
          <div className="flex-1" />
          {bulkActions.map((action) => (
            <Button
              key={action.label}
              type="button"
              size="sm"
              variant={action.variant ?? "outline"}
              onClick={() => void action.onAction(selectedRows)}
            >
              {action.icon && <action.icon className="w-3.5 h-3.5" />}
              {action.label}
            </Button>
          ))}
        </div>
      )}

      {sorted.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 py-8 text-center">{emptyMessage ?? t("dataTable.noRows")}</p>
      ) : (
        <>
          {/* Desktop/tablet: a real table with a sticky header. */}
          <div className="hidden md:block border rounded-lg dark:border-white/10 overflow-auto max-h-[70vh]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-navy-dark border-b dark:border-white/10">
                <tr>
                  {bulkActions && bulkActions.length > 0 && (
                    <th className="w-10 px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={t("dataTable.selectAll")}
                        checked={selected.size > 0 && selected.size === sorted.length}
                        onChange={toggleAll}
                        className="accent-navy"
                      />
                    </th>
                  )}
                  {visibleColumns.map((col) => (
                    <th
                      key={col.key}
                      className={cn("px-3 py-2 font-medium text-gray-600 dark:text-gray-300 whitespace-nowrap", col.align === "right" && "text-right")}
                    >
                      {col.sortValue ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(col.key)}
                          className="inline-flex items-center gap-1 hover:text-navy dark:hover:text-navy-light"
                        >
                          {col.header}
                          {sortKey === col.key ? (
                            sortDirection === "asc" ? (
                              <ArrowUp className="w-3 h-3" />
                            ) : (
                              <ArrowDown className="w-3 h-3" />
                            )
                          ) : (
                            <ArrowUpDown className="w-3 h-3 text-gray-300 dark:text-gray-600" />
                          )}
                        </button>
                      ) : (
                        col.header
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-white/10">
                {sorted.map((row) => {
                  const id = getRowId(row);
                  return (
                    <tr key={id} className={cn("dark:text-gray-200", selected.has(id) && "bg-navy-50 dark:bg-navy-light/10")}>
                      {bulkActions && bulkActions.length > 0 && (
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            aria-label={`row-${id}`}
                            checked={selected.has(id)}
                            onChange={() => toggleRow(id)}
                            className="accent-navy"
                          />
                        </td>
                      )}
                      {visibleColumns.map((col) => (
                        <td key={col.key} className={cn("px-3 py-2", col.align === "right" && "text-right")}>
                          {col.render(row)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Phone: stacked cards, one per row, label:value pairs. */}
          <div className="md:hidden space-y-2">
            {sorted.map((row) => {
              const id = getRowId(row);
              return (
                <div
                  key={id}
                  className={cn(
                    "border rounded-lg p-3 dark:border-white/10 dark:bg-navy-dark",
                    selected.has(id) && "border-navy dark:border-navy-light",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    {bulkActions && bulkActions.length > 0 && (
                      <input
                        type="checkbox"
                        aria-label={`row-${id}`}
                        checked={selected.has(id)}
                        onChange={() => toggleRow(id)}
                        className="accent-navy mt-0.5"
                      />
                    )}
                    <div className="flex-1 space-y-1">
                      {visibleColumns.map((col) => (
                        <div key={col.key} className="flex items-baseline justify-between gap-2 text-sm">
                          <span className="text-gray-500 dark:text-gray-400 flex-shrink-0">{col.header}</span>
                          <span className="text-right dark:text-gray-200">{col.render(row)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
