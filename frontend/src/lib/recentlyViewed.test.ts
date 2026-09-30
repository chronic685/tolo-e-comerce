import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getRecentlyViewedIds, recordProductView } from "./recentlyViewed";

describe("recently viewed", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("starts empty", () => {
    expect(getRecentlyViewedIds()).toEqual([]);
  });

  it("records a view and puts the newest id first", () => {
    recordProductView("a");
    recordProductView("b");
    expect(getRecentlyViewedIds()).toEqual(["b", "a"]);
  });

  it("re-viewing an id moves it to the front instead of duplicating it", () => {
    recordProductView("a");
    recordProductView("b");
    recordProductView("a");
    expect(getRecentlyViewedIds()).toEqual(["a", "b"]);
  });

  it("caps the list at 12 entries, dropping the oldest", () => {
    for (let i = 0; i < 15; i++) recordProductView(`p${i}`);
    const ids = getRecentlyViewedIds();
    expect(ids).toHaveLength(12);
    expect(ids[0]).toBe("p14");
    expect(ids).not.toContain("p0");
    expect(ids).not.toContain("p2");
  });
});
