import { useParams } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "@tolo/ui";
import { useLegalDocs, type LegalDoc } from "../lib/legalContent";

// Group 2, item 6. One route (/legal/:slug) rendering whichever doc
// matches, rather than three near-identical page components -- the
// content (legalContent.ts) is the only thing that actually differs.
export function LegalPage() {
  const { slug } = useParams<{ slug: string }>();
  const { t } = useTranslation();
  const docs = useLegalDocs();
  const doc: LegalDoc | undefined = slug ? docs[slug as LegalDoc["slug"]] : undefined;

  if (!doc) {
    return (
      <div className="max-w-2xl mx-auto text-center py-12">
        <h1 className="text-xl font-bold mb-2">{t("legal.pageNotFound")}</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm">{t("legal.documentDoesNotExist")}</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-xl font-bold mb-1">{doc.title}</h1>
      <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">{t("legal.effectiveDate", { date: doc.lastUpdated })}</p>

      <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-3 mb-6 text-xs">
        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <p>
          <strong>{t("legal.draftReviewBannerTitle")}</strong> {t("legal.draftReviewBannerBody")}
        </p>
      </div>

      <div className="space-y-5">
        {doc.sections.map((section) => (
          <section key={section.heading}>
            <h2 className="text-sm font-semibold mb-1.5">{section.heading}</h2>
            {section.body.map((paragraph, i) => (
              <p key={i} className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                {paragraph}
              </p>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
