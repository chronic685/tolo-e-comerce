/** Pulls the digits out of a command-palette query for an order-number
 * lookup (orders.order_number is a plain integer sequence) -- lets someone
 * type "TL-1042", "#1042", or just "1042" and still match. Returns null
 * when the query has no digits at all, so callers skip the order search
 * entirely rather than querying order_number = 0/NaN. */
export function parseOrderNumberQuery(query: string): number | null {
  const digits = query.replace(/\D/g, "");
  return digits ? Number(digits) : null;
}
