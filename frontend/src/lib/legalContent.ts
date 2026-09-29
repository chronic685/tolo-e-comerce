import { useTranslation } from "@tolo/ui";

// Group 2, item 6. Placeholder legal text -- drafted to be plausible and
// Ethiopia-appropriate (references to Ethiopian consumer-protection and
// data-protection law, ETB, NBE-regulated payment channels) but NOT
// reviewed or approved by counsel. Every page built from this must show
// the "pending legal review" banner (see LegalPage.tsx) and must never be
// presented to a real user/merchant as final without that review.
//
// Group 5: the actual English/Amharic text lives in packages/ui's locale
// files (keys "legal.<doc>.section.<n>.heading"/".body") -- a hook, not a
// plain exported const, since it needs the active locale via
// useTranslation(). Amharic translations here carry the SAME
// "machine_translated, pending review" status as everything else in
// am.ts, on top of this content's own separate pending legal review.
export interface LegalSection {
  heading: string;
  body: string[];
}

export interface LegalDoc {
  slug: "terms" | "privacy" | "refund-policy";
  title: string;
  lastUpdated: string;
  sections: LegalSection[];
}

const EFFECTIVE_DATE = "2026-01-01";

const SECTION_COUNTS: Record<LegalDoc["slug"], number> = {
  terms: 11,
  privacy: 9,
  "refund-policy": 7,
};

const DOC_KEY: Record<LegalDoc["slug"], string> = {
  terms: "terms",
  privacy: "privacy",
  "refund-policy": "refund",
};

const TITLE_KEY: Record<LegalDoc["slug"], string> = {
  terms: "legal.termsTitle",
  privacy: "legal.privacyTitle",
  "refund-policy": "legal.refundPolicyTitle",
};

export function useLegalDocs(): Record<LegalDoc["slug"], LegalDoc> {
  const { t } = useTranslation();
  const slugs: LegalDoc["slug"][] = ["terms", "privacy", "refund-policy"];
  return Object.fromEntries(
    slugs.map((slug) => [
      slug,
      {
        slug,
        title: t(TITLE_KEY[slug]),
        lastUpdated: EFFECTIVE_DATE,
        sections: Array.from({ length: SECTION_COUNTS[slug] }, (_, i) => i + 1).map((n) => ({
          heading: t(`legal.${DOC_KEY[slug]}.section.${n}.heading`),
          body: [t(`legal.${DOC_KEY[slug]}.section.${n}.body`)],
        })),
      },
    ]),
  ) as Record<LegalDoc["slug"], LegalDoc>;
}
