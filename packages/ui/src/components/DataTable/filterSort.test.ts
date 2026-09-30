import { describe, expect, it } from "vitest";
import { filterRows, sortRows } from "./filterSort";

interface Row {
  id: string;
  name: string;
  total: number;
}

const rows: Row[] = [
  { id: "1", name: "Banana bread", total: 30 },
  { id: "2", name: "Apple pie", total: 10 },
  { id: "3", name: "Cherry tart", total: 20 },
];

const columns = [{ key: "name", filterValue: (r: Row) => r.name, sortValue: (r: Row) => r.name }, { key: "total", sortValue: (r: Row) => r.total }];

describe("filterRows", () => {
  it("returns every row for an empty/whitespace query", () => {
    expect(filterRows(rows, columns, "  ")).toEqual(rows);
  });

  it("matches case-insensitively against any filterable column", () => {
    expect(filterRows(rows, columns, "apple").map((r) => r.id)).toEqual(["2"]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterRows(rows, columns, "durian")).toEqual([]);
  });
});

describe("sortRows", () => {
  it("returns rows unchanged when sortKey is null", () => {
    expect(sortRows(rows, columns, null, "asc")).toEqual(rows);
  });

  it("sorts numerically ascending", () => {
    expect(sortRows(rows, columns, "total", "asc").map((r) => r.id)).toEqual(["2", "3", "1"]);
  });

  it("sorts numerically descending", () => {
    expect(sortRows(rows, columns, "total", "desc").map((r) => r.id)).toEqual(["1", "3", "2"]);
  });

  it("sorts alphabetically by string sortValue", () => {
    expect(sortRows(rows, columns, "name", "asc").map((r) => r.id)).toEqual(["2", "1", "3"]);
  });

  it("does not mutate the input array", () => {
    const copy = [...rows];
    sortRows(rows, columns, "total", "desc");
    expect(rows).toEqual(copy);
  });
});
