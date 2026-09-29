// Shared shape for stores.operating_hours (migration 0057). Keys are
// 3-letter lowercase weekday abbreviations; a missing key or explicit null
// means closed that day. An empty object means "no hours configured" --
// only the store's status then decides open/closed.
export type DayKey = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";
export type DayHours = { open: string; close: string } | null;
export type OperatingHours = Partial<Record<DayKey, DayHours>>;

export const DAY_KEYS: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export const DAY_LABELS: Record<DayKey, string> = {
  sun: "Sunday",
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
};

// Ethiopia is a fixed UTC+3 year-round (no daylight saving) -- hardcoding
// the offset here avoids depending on Intl/IANA timezone name support,
// which varies across the browser/Node/Deno environments this project
// actually runs in, for the same reason the server-side check (migration
// 0057's store_is_open_now()) uses a literal `at time zone` conversion.
const ETHIOPIA_UTC_OFFSET_MINUTES = 3 * 60;

function nowInEthiopia(): Date {
  return new Date(Date.now() + ETHIOPIA_UTC_OFFSET_MINUTES * 60_000);
}

export function todaysHours(hours: OperatingHours | null | undefined): DayHours {
  if (!hours) return null;
  const dayKey = DAY_KEYS[nowInEthiopia().getUTCDay()];
  return hours[dayKey] ?? null;
}

// Client-side approximation for a live preview while a merchant is editing
// hours in Store Settings -- NOT the authoritative check. The real check
// that actually blocks/allows an order is store_is_open_now() (migration
// 0057), enforced server-side inside create_order(); this must never be
// trusted to gate anything, only to preview what a customer would see.
export function isOpenNowClientSide(status: string, hours: OperatingHours | null | undefined): boolean {
  if (status !== "active") return false;
  if (!hours || Object.keys(hours).length === 0) return true;

  const today = todaysHours(hours);
  if (!today) return false;

  const now = nowInEthiopia();
  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const [openH, openM] = today.open.split(":").map(Number);
  const [closeH, closeM] = today.close.split(":").map(Number);
  return nowMinutes >= openH * 60 + openM && nowMinutes <= closeH * 60 + closeM;
}
