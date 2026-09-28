import { Navigate, Outlet, useLocation } from "react-router-dom";
import { SkeletonPage } from "@tolo/ui";
import { useAuth } from "../lib/AuthContext";

export function ProtectedRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <SkeletonPage />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;

  return <Outlet />;
}
