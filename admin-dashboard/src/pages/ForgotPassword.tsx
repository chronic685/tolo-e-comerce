import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";

const RESEND_COOLDOWN_SECONDS = 30;

export function ForgotPassword() {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  function startCooldown() {
    setCooldown(RESEND_COOLDOWN_SECONDS);
    const timer = setInterval(() => {
      setCooldown((s) => {
        if (s <= 1) {
          clearInterval(timer);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (cooldown > 0) return;
    setLoading(true);
    setError(null);
    const { error } = await requestPasswordReset(email);
    setLoading(false);
    if (error && !/user not found/i.test(error)) {
      setError("We couldn't complete the request. Please try again.");
      return;
    }
    setSent(true);
    startCooldown();
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="max-w-sm w-full bg-white border rounded-lg p-8">
        {sent ? (
          <div className="text-center">
            <h1 className="text-xl font-bold mb-2">Check your email</h1>
            <p className="text-gray-600 text-sm mb-4">
              If a staff account exists for <strong>{email}</strong>, we've sent a password-reset link.
            </p>
            <button
              onClick={handleSubmit}
              disabled={cooldown > 0 || loading}
              className="text-navy text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {cooldown > 0 ? `Resend available in ${cooldown}s` : loading ? "Sending..." : "Resend link"}
            </button>
            <p className="text-sm text-gray-500 mt-4">
              <Link to="/login" className="text-navy font-medium">
                Back to login
              </Link>
            </p>
          </div>
        ) : (
          <>
            <h1 className="text-xl font-bold mb-1">Forgot your password?</h1>
            <p className="text-sm text-gray-500 mb-4">Enter your staff account email and we'll send you a password-reset link.</p>
            <form onSubmit={handleSubmit} className="space-y-3">
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full border rounded-md px-3 py-2 text-sm"
              />
              {error && <p className="text-red-600 text-sm">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-navy text-white py-2.5 rounded-md font-medium hover:bg-navy-dark disabled:opacity-60"
              >
                {loading ? "Sending..." : "Send reset link"}
              </button>
            </form>
            <p className="text-sm text-gray-500 mt-4">
              <Link to="/login" className="text-navy font-medium">
                Back to login
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
