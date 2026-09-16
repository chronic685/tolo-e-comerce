import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { useMerchant } from "../lib/MerchantContext";
import { MerchantApplication } from "../pages/MerchantApplication";

const statusMessages: Record<string, string> = {
  registered: "Your application has been received and is awaiting Tolo's review.",
  pending_verification: "Your application is pending verification.",
  under_review: "Tolo is currently reviewing your application.",
  rejected: "Your merchant application was rejected. Contact Tolo support for details.",
  suspended: "Your merchant account has been suspended. Contact Tolo support.",
  closed: "Your merchant account has been closed.",
};

export function MerchantGate() {
  const { user, loading: authLoading } = useAuth();
  const { merchant, loading: merchantLoading } = useMerchant();

  if (authLoading || merchantLoading) {
    return <p className="text-center text-gray-500 py-16">Loading...</p>;
  }

  if (!user) return <Navigate to="/login" replace />;

  if (!merchant) return <MerchantApplication />;

  if (merchant.status !== "active" && merchant.status !== "approved") {
    return (
      <div className="max-w-md mx-auto mt-16 text-center bg-white border rounded-lg p-8">
        <h1 className="text-lg font-bold mb-2">Application status: {merchant.status.replace(/_/g, " ")}</h1>
        <p className="text-gray-600 text-sm">{statusMessages[merchant.status] ?? "Please wait for Tolo to process your account."}</p>
      </div>
    );
  }

  return <Outlet />;
}
