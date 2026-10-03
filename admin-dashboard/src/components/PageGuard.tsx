import type { ReactNode } from "react";
import { useAuth } from "../lib/AuthContext";
import { SkeletonPage, useTranslation } from "@tolo/ui";

// Second, finer-grained gate inside ProtectedRoute (which only checks "is
// this an authenticated Tolo staff member at all"): each route element is
// wrapped with this to also check the specific page. Hiding a nav link in
// Layout.tsx isn't enforcement on its own — this is what actually stops
// someone without access from seeing the page by typing the URL directly.
export function PageGuard({ pageKey, children }: { pageKey: string; children: ReactNode }) {
  const { hasAccess, loading } = useAuth();
  const { t } = useTranslation();

  if (loading) return <SkeletonPage />;

  if (!hasAccess(pageKey)) {
    return (
      <div className="max-w-md mx-auto mt-16 text-center bg-white dark:bg-navy-dark border rounded-lg p-8">
        <h1 className="text-lg font-bold mb-2">{t("pageGuard.notAuthorizedTitle")}</h1>
        <p className="text-gray-600 dark:text-gray-300 text-sm">{t("pageGuard.notAuthorizedBody")}</p>
      </div>
    );
  }

  return <>{children}</>;
}
