import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast, translateServerError, useTranslation } from "@tolo/ui";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";

type RecoveryState = "checking" | "ready" | "invalid";

const RECOVERY_DETECTION_TIMEOUT_MS = 4000;

export function ResetPassword() {
  const { updatePassword, signOut } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [recoveryState, setRecoveryState] = useState<RecoveryState>("checking");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setRecoveryState("ready");
    });

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setRecoveryState((s) => (s === "checking" ? "ready" : s));
    });

    const timeout = setTimeout(() => {
      setRecoveryState((s) => (s === "checking" ? "invalid" : s));
    }, RECOVERY_DETECTION_TIMEOUT_MS);

    return () => {
      listener.subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      toast.error(t("auth.passwordTooWeak"));
      return;
    }
    if (password !== confirmPassword) {
      toast.error(t("validation.passwordsDontMatch"));
      return;
    }
    setSubmitting(true);
    const { error } = await updatePassword(password);
    setSubmitting(false);
    if (error) {
      toast.error(translateServerError(error, t));
      return;
    }
    setDone(true);
    await signOut();
  }

  if (recoveryState === "checking") {
    return <p className="text-center text-gray-500 dark:text-gray-400 py-16">Verifying your reset link...</p>;
  }

  if (recoveryState === "invalid") {
    return (
      <div className="max-w-sm mx-auto mt-16 text-center">
        <h1 className="text-xl font-bold mb-2">Link invalid or expired</h1>
        <p className="text-gray-600 dark:text-gray-300 text-sm mb-4">This password-reset link is invalid or has expired.</p>
        <button onClick={() => navigate("/forgot-password")} className="text-navy text-sm font-medium">
          Request a new reset link
        </button>
      </div>
    );
  }

  if (done) {
    return (
      <div className="max-w-sm mx-auto mt-16 text-center">
        <h1 className="text-xl font-bold mb-2">Password updated</h1>
        <p className="text-gray-600 dark:text-gray-300 text-sm mb-4">Your password has been changed. Sign in with your new password.</p>
        <button
          onClick={() => navigate("/login")}
          className="bg-navy text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-navy-dark"
        >
          Go to login
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-sm mx-auto mt-16">
      <h1 className="text-xl font-bold mb-1">Set a new password</h1>
      <form onSubmit={handleSubmit} className="space-y-3 mt-4">
        <input
          type="password"
          placeholder="New password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
        <input
          type="password"
          placeholder="Confirm new password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          minLength={6}
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-navy text-white py-2.5 rounded-md font-medium hover:bg-navy-dark disabled:opacity-60"
        >
          {submitting ? "Updating password..." : "Update password"}
        </button>
      </form>
    </div>
  );
}
