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
