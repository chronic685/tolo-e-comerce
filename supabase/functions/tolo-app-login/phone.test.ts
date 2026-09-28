import { describe, expect, it } from "vitest";
import { normalizeEthiopianPhone } from "./phone.ts";

describe("normalizeEthiopianPhone", () => {
  it("accepts an already-correct +251 number", () => {
    expect(normalizeEthiopianPhone("+251912345678")).toBe("+251912345678");
  });

  it("adds the + when 251 is present without it", () => {
    expect(normalizeEthiopianPhone("251912345678")).toBe("+251912345678");
  });

  it("converts a local leading-0 number", () => {
    expect(normalizeEthiopianPhone("0912345678")).toBe("+251912345678");
  });

  it("accepts a bare 9-digit subscriber number", () => {
    expect(normalizeEthiopianPhone("912345678")).toBe("+251912345678");
  });

  it("accepts the newer 7-prefixed mobile range", () => {
    expect(normalizeEthiopianPhone("0712345678")).toBe("+251712345678");
  });

  it("strips spaces, dashes, and parens", () => {
    expect(normalizeEthiopianPhone("+251 91-234 (5678)")).toBe("+251912345678");
  });

  it("rejects too few digits", () => {
    expect(normalizeEthiopianPhone("09123456")).toBeNull();
  });

  it("rejects too many digits", () => {
    expect(normalizeEthiopianPhone("091234567890")).toBeNull();
  });

  it("rejects a non-mobile prefix", () => {
    expect(normalizeEthiopianPhone("0812345678")).toBeNull();
  });

  it("rejects garbage input", () => {
    expect(normalizeEthiopianPhone("not-a-phone")).toBeNull();
  });
});
