import { describe, expect, it } from "vitest";
import { LICENSE_MAX_BYTES, licensePath, submitErrorKey, validateLicenseFile } from "./merchantApplication";

describe("validateLicenseFile", () => {
  it("accepts JPEG, PNG and WebP up to 5 MB", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      expect(validateLicenseFile({ type, size: LICENSE_MAX_BYTES })).toBeNull();
    }
  });

  it("rejects other types, including PDFs and GIFs", () => {
    expect(validateLicenseFile({ type: "application/pdf", size: 1000 })).toBe("merchantApply.error.licenseType");
    expect(validateLicenseFile({ type: "image/gif", size: 1000 })).toBe("merchantApply.error.licenseType");
  });

  it("rejects anything over 5 MB", () => {
    expect(validateLicenseFile({ type: "image/png", size: LICENSE_MAX_BYTES + 1 })).toBe("merchantApply.error.licenseSize");
  });
});

describe("licensePath", () => {
  it("puts the file in the user's own folder with an extension from its type", () => {
    expect(licensePath("user-1", { type: "image/png" }, "abc")).toBe("user-1/abc.png");
  });
});

describe("submitErrorKey", () => {
  it("maps known server errors to their own message", () => {
    expect(submitErrorKey("application_pending")).toBe("merchantApply.error.application_pending");
    expect(submitErrorKey("phone_not_verified")).toBe("merchantApply.error.phone_not_verified");
  });

  it("falls back to a generic message for anything else", () => {
    expect(submitErrorKey("duplicate key value violates something")).toBe("merchantApply.error.generic");
    expect(submitErrorKey(undefined)).toBe("merchantApply.error.generic");
  });
});
