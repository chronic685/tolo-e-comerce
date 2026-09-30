export interface DateRange {
  start: Date;
  end: Date;
}

/** [start, end] inclusive, `end` at end-of-day so a range built for "today"
 * actually includes everything that happens today. */
export function lastNDays(n: number, now: Date = new Date()): DateRange {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const start = new Date(now);
  start.setDate(start.getDate() - (n - 1));
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

export function toDateInputValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function fromDateInputValue(value: string): Date | null {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
