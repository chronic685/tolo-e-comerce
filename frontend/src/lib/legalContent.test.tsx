import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { I18nProvider } from "@tolo/ui";
import { useLegalDocs } from "./legalContent";

function wrapper({ children }: { children: React.ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}

// Group 2, item 6 / Group 5. Guards against a doc silently ending up
// empty/malformed -- LegalPage.tsx has no other validation, so a missing
// section or empty paragraph would render as visibly broken legal text.
// The content itself now lives in packages/ui's locale files and is read
// through useLegalDocs() (Group 5) rather than a plain exported const;
// i18n-key-parity.test.ts separately guards that every English key has a
// real Amharic counterpart, so this only exercises the default (English)
// locale's shape.
describe("legal content (Terms/Privacy/Refund placeholders)", () => {
  const slugs = ["terms", "privacy", "refund-policy"] as const;

  beforeEach(() => {
    localStorage.clear();
  });

  it("has exactly the three required documents, keyed by their own slug", () => {
    const { result } = renderHook(() => useLegalDocs(), { wrapper });
    expect(Object.keys(result.current).sort()).toEqual([...slugs].sort());
    for (const slug of slugs) {
      expect(result.current[slug].slug).toBe(slug);
    }
  });

  it.each(slugs)("%s has a title, an effective date, and at least 3 non-empty sections", (slug) => {
    const { result } = renderHook(() => useLegalDocs(), { wrapper });
    const doc = result.current[slug];
    expect(doc.title.length).toBeGreaterThan(0);
    expect(doc.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(doc.sections.length).toBeGreaterThanOrEqual(3);
    for (const section of doc.sections) {
      expect(section.heading.length).toBeGreaterThan(0);
      expect(section.body.length).toBeGreaterThan(0);
      for (const paragraph of section.body) {
        expect(paragraph.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("refund policy explicitly covers merchant-rejection and out-of-stock refunds, matching the automated flow (migration 0058)", () => {
    const { result } = renderHook(() => useLegalDocs(), { wrapper });
    const allText = result.current["refund-policy"].sections
      .flatMap((s) => s.body)
      .join(" ")
      .toLowerCase();
    expect(allText).toContain("cancel");
    expect(allText).toContain("out of stock");
  });
});
