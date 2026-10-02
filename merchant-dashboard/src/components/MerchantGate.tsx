import { Navigate, Outlet } from "react-router-dom";
import { SkeletonPage, useTranslation } from "@tolo/ui";
import { useAuth } from "../lib/AuthContext";
import { useMerchant } from "../lib/MerchantContext";
import { MerchantApplication } from "../pages/MerchantApplication";

const STATUS_KEYS: Record<string, string> = {
  registered: "merchantGate.status.registered",
  pending_verification: "merchantGate.status.pending_verification",
  under_review: "merchantGate.status.under_review",
  rejected: "merchantGate.status.rejected",
  suspended: "merchantGate.status.suspended",
  closed: "merchantGate.status.closed",
};

export function MerchantGate() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const { merchant, loading: merchantLoading } = useMerchant();

  if (authLoading || merchantLoading) {
    return <SkeletonPage />;
  }

  if (!user) return <Navigate to="/login" replace />;

  if (!merchant) return <MerchantApplication />;

  if (merchant.status !== "active" && merchant.status !== "approved") {
    return (
      <div className="max-w-md mx-auto mt-16 text-center bg-white dark:bg-navy-dark border dark:border-white/10 rounded-lg p-8">
        <h1 className="text-lg font-bold mb-2 dark:text-gray-100">
          {t("merchantGate.applicationStatusTitle", { status: merchant.status.replace(/_/g, " ") })}
        </h1>
        <p className="text-gray-600 dark:text-gray-400 text-sm">
          {STATUS_KEYS[merchant.status] ? t(STATUS_KEYS[merchant.status]) : t("merchantGate.statusDefault")}
        </p>
      </div>
    );
  }

  return <Outlet />;
}
