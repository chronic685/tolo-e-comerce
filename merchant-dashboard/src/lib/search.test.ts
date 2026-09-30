import { describe, expect, it } from "vitest";
import { parseOrderNumberQuery } from "./search";

describe("parseOrderNumberQuery", () => {
  it("extracts digits from a plain number", () => {
    expect(parseOrderNumberQuery("1042")).toBe(1042);
  });

  it("extracts digits from a TL-prefixed order number", () => {
    expect(parseOrderNumberQuery("TL-1042")).toBe(1042);
  });

  it("extracts digits from a #-prefixed order number", () => {
    expect(parseOrderNumberQuery("#1042")).toBe(1042);
  });

  it("returns null for a query with no digits", () => {
    expect(parseOrderNumberQuery("blue shirt")).toBeNull();
  });

  it("returns null for an empty query", () => {
    expect(parseOrderNumberQuery("")).toBeNull();
  });
});
