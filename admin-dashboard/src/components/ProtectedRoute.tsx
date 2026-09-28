import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { SkeletonPage } from "@tolo/ui";

export function ProtectedRoute() {
  const { user, role, loading } = useAuth();

  if (loading) return <SkeletonPage />;
  if (!user || !role) return <Navigate to="/login" replace />;

  return <Outlet />;
}
