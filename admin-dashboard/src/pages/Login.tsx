import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { ADMIN_PAGES } from "../lib/adminPages";

export function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();

  // Framing only — never passed to signIn or used for routing. Real access
  // always comes from the account's admin_tier/permissions in the database.
  const [mode, setMode] = useState<"admin" | "staff" | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    // AuthContext resolves a bare username to {username}@staff.internal
    // internally (accounts created via Users & Roles never have a real
    // email) — a real email typed here (every pre-existing account) is
    // used exactly as typed, so this one field covers both.
    const { error, permissions, adminTier } = await signIn(identifier, password);
    setLoading(false);
    if (error) {
      setError(error);
      return;
    }
    // Landing on "/" unconditionally would hit PageGuard's "Not authorized"
    // screen immediately for anyone without dashboard access — land on the
    // first page (in sidebar order) they actually have, falling back to
    // "/" only if they have none at all (a staff account not yet granted
    // anything, which has no better page to send them to).
    const isAdmin = adminTier !== null && adminTier !== undefined;
    const firstAccessible = ADMIN_PAGES.find((p) => isAdmin || permissions?.includes(p.key));
    navigate(firstAccessible?.to ?? "/");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="max-w-sm w-full bg-white border rounded-lg p-8">
        <h1 className="text-xl font-bold mb-1">Tolo Admin</h1>
        {mode === null ? (
          <>
            <p className="text-sm text-gray-500 mb-4">How are you signing in?</p>
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setMode("admin")}
                className="w-full bg-navy text-white py-2.5 rounded-md font-medium hover:bg-navy-dark"
              >
                Log in as Admin
              </button>
              <button
                type="button"
                onClick={() => setMode("staff")}
                className="w-full border border-navy text-navy py-2.5 rounded-md font-medium hover:bg-slate-50"
              >
                Log in as Staff
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-gray-500">{mode === "admin" ? "Admin sign in." : "Staff sign in."}</p>
              <button
                type="button"
                onClick={() => {
                  setMode(null);
                  setError(null);
                }}
                className="text-xs text-navy font-medium"
              >
                Change
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-3">
              <input
                type="text"
                placeholder="Username or email"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
                autoFocus
                autoCapitalize="none"
                className="w-full border rounded-md px-3 py-2 text-sm"
              />
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full border rounded-md px-3 py-2 text-sm"
              />
              {error && <p className="text-red-600 text-sm">{error}</p>}
              <div className="text-right">
                <Link to="/forgot-password" className="text-xs text-navy font-medium">
                  Forgot password?
                </Link>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-navy text-white py-2.5 rounded-md font-medium hover:bg-navy-dark disabled:opacity-60"
              >
                {loading ? "Signing in..." : "Sign in"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
