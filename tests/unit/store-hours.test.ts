import { describe, expect, it, vi } from "vitest";
import { isOpenNowClientSide, todaysHours, type OperatingHours } from "../../packages/ui/src/lib/storeHours";

// Group 1, item 4. Ethiopia is a fixed UTC+3 -- pin Date.now() to a known
// instant so "today" and "now" are deterministic instead of depending on
// whatever day/time the test happens to run. 2026-01-05 is a Monday.
const MONDAY_NOON_UTC = new Date("2026-01-05T09:30:00Z").getTime(); // 12:30 Addis Ababa time

describe("store hours (client-side preview, migration 0057's storeHours.ts)", () => {
  it("todaysHours reads the current day's entry", () => {
    vi.useFakeTimers();
    vi.setSystemTime(MONDAY_NOON_UTC);
    const hours: OperatingHours = { mon: { open: "09:00", close: "21:00" }, tue: { open: "10:00", close: "20:00" } };
    expect(todaysHours(hours)).toEqual({ open: "09:00", close: "21:00" });
    vi.useRealTimers();
  });

  it("todaysHours returns null for a day with no entry or an explicit null", () => {
    vi.useFakeTimers();
    vi.setSystemTime(MONDAY_NOON_UTC);
    expect(todaysHours({ mon: null })).toBeNull();
    expect(todaysHours({})).toBeNull();
    expect(todaysHours(null)).toBeNull();
    vi.useRealTimers();
  });

  it("isOpenNowClientSide is false whenever status isn't active, regardless of hours", () => {
    expect(isOpenNowClientSide("paused", {})).toBe(false);
    expect(isOpenNowClientSide("closed", { mon: { open: "00:00", close: "23:59" } })).toBe(false);
  });

  it("isOpenNowClientSide is true for an active store with no hours configured at all", () => {
    expect(isOpenNowClientSide("active", {})).toBe(true);
  });

  it("isOpenNowClientSide respects today's open/close window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(MONDAY_NOON_UTC); // 12:30 local
    expect(isOpenNowClientSide("active", { mon: { open: "09:00", close: "21:00" } })).toBe(true);
    expect(isOpenNowClientSide("active", { mon: { open: "13:00", close: "21:00" } })).toBe(false);
    expect(isOpenNowClientSide("active", { mon: { open: "06:00", close: "12:00" } })).toBe(false);
    vi.useRealTimers();
  });

  it("isOpenNowClientSide is false when today is explicitly marked closed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(MONDAY_NOON_UTC);
    expect(isOpenNowClientSide("active", { mon: null, tue: { open: "09:00", close: "21:00" } })).toBe(false);
    vi.useRealTimers();
  });
});
