import { describe, expect, it } from "vitest";
import { formatOrderNumber } from "../../packages/ui/src/lib/format";

describe("formatOrderNumber", () => {
  it("prefixes a numeric order_number with TL-", () => {
    expect(formatOrderNumber(1001)).toBe("TL-1001");
  });

  it("accepts a string order_number too", () => {
    expect(formatOrderNumber("2048")).toBe("TL-2048");
  });
});
