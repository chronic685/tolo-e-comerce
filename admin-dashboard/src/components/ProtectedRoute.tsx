import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";

export function ProtectedRoute() {
  const { user, role, loading } = useAuth();

  if (loading) return <p className="text-center text-gray-500 py-16">Loading...</p>;
  if (!user || !role) return <Navigate to="/login" replace />;

  return <Outlet />;
}
