import { describe, expect, it } from "vitest";
import { fromDateInputValue, lastNDays, toDateInputValue } from "./dateRange";

describe("lastNDays", () => {
  it("spans exactly n calendar days including today", () => {
    const { start, end } = lastNDays(7, new Date(2024, 0, 31));
    expect(toDateInputValue(start)).toBe("2024-01-25");
    expect(toDateInputValue(end)).toBe("2024-01-31");
  });

  it("start is midnight and end is end-of-day", () => {
    const { start, end } = lastNDays(1, new Date(2024, 0, 31, 12, 30));
    expect(start.getHours()).toBe(0);
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
  });
});

describe("toDateInputValue / fromDateInputValue", () => {
  it("round-trips a date through the yyyy-mm-dd input format", () => {
    const date = new Date(2024, 2, 5); // March 5
    const value = toDateInputValue(date);
    expect(value).toBe("2024-03-05");
    const parsed = fromDateInputValue(value)!;
    expect(parsed.getFullYear()).toBe(2024);
    expect(parsed.getMonth()).toBe(2);
    expect(parsed.getDate()).toBe(5);
  });

  it("returns null for an empty string", () => {
    expect(fromDateInputValue("")).toBeNull();
  });
});
