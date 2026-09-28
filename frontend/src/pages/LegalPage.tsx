import { useParams } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { LEGAL_DOCS, type LegalDoc } from "../lib/legalContent";

// Group 2, item 6. One route (/legal/:slug) rendering whichever doc
// matches, rather than three near-identical page components -- the
// content (legalContent.ts) is the only thing that actually differs.
export function LegalPage() {
  const { slug } = useParams<{ slug: string }>();
  const doc: LegalDoc | undefined = slug ? LEGAL_DOCS[slug as LegalDoc["slug"]] : undefined;

  if (!doc) {
    return (
      <div className="max-w-2xl mx-auto text-center py-12">
        <h1 className="text-xl font-bold mb-2">Page not found</h1>
        <p className="text-gray-500 text-sm">This legal document doesn't exist.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-xl font-bold mb-1">{doc.title}</h1>
      <p className="text-xs text-gray-400 mb-4">Effective {doc.lastUpdated}</p>

      <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-3 mb-6 text-xs">
        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <p>
          <strong>Draft — pending legal review.</strong> This is placeholder text prepared for Tolo's launch and has not yet been reviewed
          or approved by qualified Ethiopian legal counsel. Do not treat it as final or legally binding.
        </p>
      </div>

      <div className="space-y-5">
        {doc.sections.map((section) => (
          <section key={section.heading}>
            <h2 className="text-sm font-semibold mb-1.5">{section.heading}</h2>
            {section.body.map((paragraph, i) => (
              <p key={i} className="text-sm text-gray-600 leading-relaxed">
                {paragraph}
              </p>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
