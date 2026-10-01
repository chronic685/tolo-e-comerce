import { describe, expect, it } from "vitest";
import { ADMIN_PAGES, GRANTABLE_ADMIN_PAGES } from "./adminPages";

describe("admin-tier-only pages", () => {
  it("Merchant Applications is admin-tier only and never offered in the staff page checklist", () => {
    const page = ADMIN_PAGES.find((p) => p.key === "merchant_applications");
    expect(page?.adminTierOnly).toBe(true);
    expect(GRANTABLE_ADMIN_PAGES.map((p) => p.key)).not.toContain("merchant_applications");
  });

  it("every other page stays grantable", () => {
    expect(GRANTABLE_ADMIN_PAGES).toHaveLength(ADMIN_PAGES.length - 1);
  });
});
