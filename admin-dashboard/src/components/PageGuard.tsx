import type { ReactNode } from "react";
import { useAuth } from "../lib/AuthContext";

// Second, finer-grained gate inside ProtectedRoute (which only checks "is
// this an authenticated Tolo staff member at all"): each route element is
// wrapped with this to also check the specific page. Hiding a nav link in
// Layout.tsx isn't enforcement on its own — this is what actually stops
// someone without access from seeing the page by typing the URL directly.
export function PageGuard({ pageKey, children }: { pageKey: string; children: ReactNode }) {
  const { hasAccess, loading } = useAuth();

  if (loading) return <p className="text-center text-gray-500 py-16">Loading...</p>;

  if (!hasAccess(pageKey)) {
    return (
      <div className="max-w-md mx-auto mt-16 text-center bg-white border rounded-lg p-8">
        <h1 className="text-lg font-bold mb-2">Not authorized</h1>
        <p className="text-gray-600 text-sm">
          You don't have access to this page. Ask a super admin to grant it from Users &amp; Roles if you need it.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
