import { describe, expect, it } from "vitest";
import { ADMIN_PAGES, GRANTABLE_ADMIN_PAGES } from "./adminPages";

describe("Merchants and Merchant Applications are one page", () => {
  it("has no separate Merchant Applications page any more (it is a tab of Merchants, admin tier only)", () => {
    expect(ADMIN_PAGES.find((p) => p.key === "merchant_applications")).toBeUndefined();
    expect(ADMIN_PAGES.find((p) => p.to === "/merchant-applications")).toBeUndefined();
    expect(ADMIN_PAGES.find((p) => p.key === "merchants")?.to).toBe("/merchants");
  });

  it("every page is grantable through the staff checklist", () => {
    expect(GRANTABLE_ADMIN_PAGES).toHaveLength(ADMIN_PAGES.length);
    expect(GRANTABLE_ADMIN_PAGES.map((p) => p.key)).toContain("merchants");
  });
});
