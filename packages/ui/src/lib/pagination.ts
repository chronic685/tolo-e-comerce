// Single source of truth for list page sizes across all three apps, and the
// small pure math both usePagination and every page's Supabase query share.
export const CUSTOMER_PAGE_SIZE = 12;
export const ADMIN_PAGE_SIZE = 20;

export function totalPagesFor(totalCount: number, pageSize: number): number {
  return Math.max(1, Math.ceil(totalCount / pageSize));
}

// Inclusive 0-based [from, to] pair for Supabase's .range(from, to).
export function rangeFor(page: number, pageSize: number): [number, number] {
  const from = (page - 1) * pageSize;
  return [from, from + pageSize - 1];
}
