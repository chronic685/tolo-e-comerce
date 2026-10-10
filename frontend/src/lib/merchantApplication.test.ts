import { describe, expect, it } from "vitest";
import { isValidTin, LICENSE_MAX_BYTES, LICENSE_UPLOAD_ENABLED, licensePath, submitErrorKey, validateLicenseFile } from "./merchantApplication";

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

describe("isValidTin", () => {
  it("accepts exactly ten digits", () => {
    expect(isValidTin("0123456789")).toBe(true);
    expect(isValidTin("9999999999")).toBe(true);
  });

  it("rejects anything else", () => {
    for (const bad of ["", "123456789", "12345678901", "12345abcde", "123 456 789", "١٢٣٤٥٦٧٨٩٠", " 1234567890", "1234567890\n"]) {
      expect(isValidTin(bad)).toBe(false);
    }
  });
});

describe("license upload switch", () => {
  it("is off: the form asks for a TIN, not a photo (flip LICENSE_UPLOAD_ENABLED to bring it back)", () => {
    expect(LICENSE_UPLOAD_ENABLED).toBe(false);
  });
});

describe("submitErrorKey", () => {
  it("maps the TIN errors to their own messages", () => {
    expect(submitErrorKey("invalid_tin")).toBe("merchantApply.error.invalid_tin");
    expect(submitErrorKey("tin_already_registered")).toBe("merchantApply.error.tin_already_registered");
  });

  it("maps known server errors to their own message", () => {
    expect(submitErrorKey("application_pending")).toBe("merchantApply.error.application_pending");
    expect(submitErrorKey("phone_not_verified")).toBe("merchantApply.error.phone_not_verified");
  });

  it("falls back to a generic message for anything else", () => {
    expect(submitErrorKey("duplicate key value violates something")).toBe("merchantApply.error.generic");
    expect(submitErrorKey(undefined)).toBe("merchantApply.error.generic");
  });
});
