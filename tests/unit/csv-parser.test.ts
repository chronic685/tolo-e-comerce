import { describe, expect, it } from "vitest";
import { parseCsv, parseCsvToObjects } from "../../merchant-dashboard/src/lib/csv.ts";
import { isEligibleForListing } from "../../merchant-dashboard/src/lib/productRules.ts";

// Phase 7: bulk product upload. No CSV library dependency was added for
// this — the column set is small and fixed (we define the template
// ourselves) — so this hand-rolled parser needs its own coverage for the
// quoting edge cases a naive split(",") would get wrong.
describe("parseCsv", () => {
  it("parses a simple unquoted row", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles a quoted field containing a comma", () => {
    expect(parseCsv('name,description\nMouse,"Wireless, ergonomic mouse"')).toEqual([
      ["name", "description"],
      ["Mouse", "Wireless, ergonomic mouse"],
    ]);
  });

  it("handles an escaped double-quote inside a quoted field", () => {
    // CSV escapes a literal " inside a quoted field by doubling it: ""
    expect(parseCsv('name\n"12"" screen"')).toEqual([["name"], ['12" screen']]);
  });

  it("handles a quoted field containing a newline", () => {
    expect(parseCsv('name,notes\nWidget,"Line one\nLine two"')).toEqual([
      ["name", "notes"],
      ["Widget", "Line one\nLine two"],
    ]);
  });

  it("tolerates CRLF line endings", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("ignores a trailing blank line", () => {
    expect(parseCsv("a,b\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("parseCsvToObjects", () => {
  it("maps rows to objects keyed by the header row", () => {
    const objects = parseCsvToObjects("name,price\nMouse,450\nWallet,1200");
    expect(objects).toEqual([
      { name: "Mouse", price: "450" },
      { name: "Wallet", price: "1200" },
    ]);
  });

  it("returns an empty array for a header-only file", () => {
    expect(parseCsvToObjects("name,price")).toEqual([]);
  });

  it("trims whitespace around header names and values", () => {
    const objects = parseCsvToObjects(" name , price \n Mouse , 450 ");
    expect(objects).toEqual([{ name: "Mouse", price: "450" }]);
  });
});

// Same rule as migration 0041's database trigger — the bulk-upload preview
// decides "will publish" vs "will save as draft" using this exact function,
// so it has to agree with what the server will actually accept.
describe("isEligibleForListing (bulk upload preview)", () => {
  it("qualifies on price alone", () => {
    expect(isEligibleForListing(1200, 0)).toBe(true);
  });

  it("qualifies on stock alone", () => {
    expect(isEligibleForListing(50, 5)).toBe(true);
  });

  it("fails when neither threshold is met", () => {
    expect(isEligibleForListing(200, 1)).toBe(false);
  });

  it("is inclusive at the exact thresholds", () => {
    expect(isEligibleForListing(1000, 0)).toBe(true);
    expect(isEligibleForListing(0, 2)).toBe(true);
  });
});
