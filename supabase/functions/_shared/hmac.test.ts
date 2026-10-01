import { describe, expect, it } from "vitest";
import { hmacSha256Hex, timingSafeEqual } from "./hmac.ts";

describe("hmacSha256Hex", () => {
  it("matches the published HMAC-SHA256 test vector", async () => {
    // Widely used reference vector (RFC 4231-style, key "key").
    expect(await hmacSha256Hex("key", "The quick brown fox jumps over the lazy dog")).toBe(
      "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8",
    );
  });

  it("changes when either the secret or the data changes", async () => {
    const base = await hmacSha256Hex("secret", "payload");
    expect(await hmacSha256Hex("other", "payload")).not.toBe(base);
    expect(await hmacSha256Hex("secret", "payload!")).not.toBe(base);
  });
});

describe("timingSafeEqual", () => {
  it("is true only for identical strings", () => {
    expect(timingSafeEqual("abc123", "abc123")).toBe(true);
    expect(timingSafeEqual("abc123", "abc124")).toBe(false);
    expect(timingSafeEqual("abc123", "abc12")).toBe(false);
    expect(timingSafeEqual("", "")).toBe(true);
  });
});
