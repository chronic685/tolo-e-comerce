// Every admin CSV export needs the WHOLE matching result set, not just the
// page on screen -- but PostgREST/Supabase caps every single response at
// `api.max_rows` (supabase/config.toml, currently 1000) regardless of the
// range requested. A one-shot `.range(0, 4999)` silently returns only the
// first 1000 rows with no error, so any export past that size was quietly
// truncated. This walks the same query in max_rows-sized pages until a
// short page proves there's nothing left.
//
// `fetchPage` must build a FRESH query each call (Supabase query builders
// are single-use thenables) -- see any admin handleExport() for the pattern:
// wrap the existing filter chain in an arrow function that takes (from, to).
export const SUPABASE_MAX_ROWS_PER_REQUEST = 1000;

export interface FetchPageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

export async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<FetchPageResult<T>>,
  pageSize: number = SUPABASE_MAX_ROWS_PER_REQUEST,
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) return rows;
    from += pageSize;
  }
}

// `.in("col", ids)` goes into the request URL, so a few hundred ids already
// risks an over-long URL (the request fails outright), and the rows that come
// back are still capped at max_rows. This walks `ids` in small chunks and pages
// each chunk, for the dashboards' "rows belonging to this list of orders"
// lookups (top products for a date range, a settlement's refunds, ...).
// `fetchPage` must build a fresh query per call and ORDER BY a unique column,
// or pages can overlap or skip rows.
export const IDS_PER_REQUEST = 100;

export async function fetchAllRowsForIds<T>(
  ids: readonly string[],
  fetchPage: (idChunk: string[], from: number, to: number) => PromiseLike<FetchPageResult<T>>,
  chunkSize: number = IDS_PER_REQUEST,
): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    rows.push(...(await fetchAllRows<T>((from, to) => fetchPage(chunk, from, to))));
  }
  return rows;
}
