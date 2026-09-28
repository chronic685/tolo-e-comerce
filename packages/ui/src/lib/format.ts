/** e.g. formatCurrency(127200) -> "127,200 ETB" */
export function formatCurrency(amount: number, currency = "ETB"): string {
  const rounded = Math.round(amount * 100) / 100;
  const formatted = rounded.toLocaleString("en-US", {
    minimumFractionDigits: rounded % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${formatted} ${currency}`;
}

/** e.g. formatOrderNumber(1234) -> "TL-1234" -- orders.order_number
 * (migration 0056) is a plain sequence-backed bigint; the "TL-" prefix is
 * applied here rather than stored, so it can be changed without another
 * migration or backfill. */
export function formatOrderNumber(orderNumber: number | string): string {
  return `TL-${orderNumber}`;
}

/** e.g. formatDate("2026-09-26T18:43:00Z") -> "Sep 26, 2026" */
export function formatDate(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/** e.g. formatDateTime("2026-09-26T18:43:00Z") -> "Sep 26, 2026, 6:43 PM" */
export function formatDateTime(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** e.g. formatRelativeTime(fiveMinutesAgo) -> "5 min ago" */
export function formatRelativeTime(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(date);
}
