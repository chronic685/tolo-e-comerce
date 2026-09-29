import { describe, expect, it } from "vitest";
import { LEGAL_DOCS } from "../../frontend/src/lib/legalContent";

// Group 2, item 6. Guards against a doc silently ending up empty/malformed
// -- LegalPage.tsx has no other validation, so a missing section or empty
// paragraph would render as visibly broken legal text.
describe("legal content (Terms/Privacy/Refund placeholders)", () => {
  const slugs = ["terms", "privacy", "refund-policy"] as const;

  it("has exactly the three required documents, keyed by their own slug", () => {
    expect(Object.keys(LEGAL_DOCS).sort()).toEqual([...slugs].sort());
    for (const slug of slugs) {
      expect(LEGAL_DOCS[slug].slug).toBe(slug);
    }
  });

  it.each(slugs)("%s has a title, an effective date, and at least 3 non-empty sections", (slug) => {
    const doc = LEGAL_DOCS[slug];
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
    const allText = LEGAL_DOCS["refund-policy"].sections.flatMap((s) => s.body).join(" ").toLowerCase();
    expect(allText).toContain("cancel");
    expect(allText).toContain("out of stock");
  });
});
