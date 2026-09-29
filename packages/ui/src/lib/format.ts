import { getCurrentLocale } from "../i18n/locale";
import { resolveString } from "../i18n/loadTranslations";
import type { Locale } from "../i18n/types";

// Ethiopia doesn't use different digit grouping/decimal conventions
// between English and Amharic commerce contexts (both use Western Arabic
// numerals) -- so unlike formatRelativeTime below, the numeral formatting
// itself doesn't need to change per locale. "en-US" is kept as the
// grouping convention on purpose (thousands separated by commas), not a
// leftover English default.
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

function intlLocale(locale: Locale): string {
  return locale === "am" ? "am-ET" : "en-US";
}

/** e.g. formatDate("2026-09-26T18:43:00Z") -> "Sep 26, 2026" (or the
 * Amharic month name when the active locale is "am") -- always the
 * Gregorian calendar (item 5: "Gregorian stays the default"). Reads the
 * current app locale automatically (see i18n/locale.ts) so existing call
 * sites across all three apps don't need to be touched to pick this up;
 * pass `locale` explicitly only where a value from another locale must be
 * shown regardless of the viewer's own setting. */
export function formatDate(value: string | Date, locale: Locale = getCurrentLocale()): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleDateString(intlLocale(locale), { year: "numeric", month: "short", day: "numeric" });
}

/** e.g. formatDateTime("2026-09-26T18:43:00Z") -> "Sep 26, 2026, 6:43 PM" */
export function formatDateTime(value: string | Date, locale: Locale = getCurrentLocale()): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleString(intlLocale(locale), {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Item 5 (Group 5): "Add an option to show dates in the Ethiopian
 * calendar (Gregorian stays the default), using Intl where supported."
 * Never called automatically by anything above -- opt-in only, e.g. a
 * "Show Ethiopian date" toggle on an order/settlement detail page. Falls
 * back to the plain Gregorian formatDate() if the runtime's ICU data
 * doesn't support the ethiopic calendar (rather than throwing). */
export function formatDateEthiopian(value: string | Date, locale: Locale = getCurrentLocale()): string {
  const date = typeof value === "string" ? new Date(value) : value;
  try {
    return new Intl.DateTimeFormat(`${intlLocale(locale)}-u-ca-ethiopic`, {
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(date);
  } catch {
    return formatDate(date, locale);
  }
}

/** e.g. formatRelativeTime(fiveMinutesAgo) -> "5 min ago" (or the Amharic
 * equivalent) */
export function formatRelativeTime(value: string | Date, locale: Locale = getCurrentLocale()): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return resolveString(locale, "format.justNow");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return resolveString(locale, "format.minutesAgo").replace("{{count}}", String(minutes));
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return resolveString(locale, "format.hoursAgo").replace("{{count}}", String(hours));
  const days = Math.floor(hours / 24);
  if (days < 7) return resolveString(locale, "format.daysAgo").replace("{{count}}", String(days));
  return formatDate(date, locale);
}
