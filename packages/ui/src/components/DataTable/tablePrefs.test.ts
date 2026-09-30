import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadHiddenColumns,
  loadSavedFilters,
  persistHiddenColumns,
  removeSavedFilter,
  upsertSavedFilter,
} from "./tablePrefs";

describe("table preference persistence", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("hidden columns default to an empty array and round-trip through persistence", () => {
    expect(loadHiddenColumns("orders")).toEqual([]);
    persistHiddenColumns("orders", ["email", "phone"]);
    expect(loadHiddenColumns("orders")).toEqual(["email", "phone"]);
  });

  it("two tables' preferences never collide", () => {
    persistHiddenColumns("orders", ["email"]);
    persistHiddenColumns("products", ["sku"]);
    expect(loadHiddenColumns("orders")).toEqual(["email"]);
    expect(loadHiddenColumns("products")).toEqual(["sku"]);
  });

  it("saved filters default to an empty array and round-trip through upsert", () => {
    expect(loadSavedFilters("orders")).toEqual([]);
    const filter = { name: "Unpaid", query: "unpaid", sortKey: "total", sortDirection: "desc" as const, hiddenColumns: [] };
    upsertSavedFilter("orders", filter);
    expect(loadSavedFilters("orders")).toEqual([filter]);
  });

  it("upserting a filter with the same name replaces it instead of duplicating", () => {
    upsertSavedFilter("orders", { name: "Unpaid", query: "unpaid", sortKey: null, sortDirection: "asc", hiddenColumns: [] });
    upsertSavedFilter("orders", { name: "Unpaid", query: "unpaid v2", sortKey: null, sortDirection: "asc", hiddenColumns: [] });
    const filters = loadSavedFilters("orders");
    expect(filters).toHaveLength(1);
    expect(filters[0].query).toBe("unpaid v2");
  });

  it("removeSavedFilter deletes only the named filter", () => {
    upsertSavedFilter("orders", { name: "A", query: "a", sortKey: null, sortDirection: "asc", hiddenColumns: [] });
    upsertSavedFilter("orders", { name: "B", query: "b", sortKey: null, sortDirection: "asc", hiddenColumns: [] });
    removeSavedFilter("orders", "A");
    expect(loadSavedFilters("orders").map((f) => f.name)).toEqual(["B"]);
  });
});
