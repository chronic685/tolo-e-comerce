import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { toast, useTranslation } from "@tolo/ui";

const RESEND_COOLDOWN_SECONDS = 30;

export function ForgotPassword() {
  const { t } = useTranslation();
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
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
    // Someone who types their synthetic address directly would otherwise get
    // "check your email" for an inbox that doesn't exist.
    if (email.trim().toLowerCase().endsWith("@staff.internal")) {
      toast.error(t("errors.staffAccountNoEmailReset"));
      return;
    }
    setLoading(true);
    const { error } = await requestPasswordReset(email);
    setLoading(false);
    if (error && !/user not found/i.test(error)) {
      toast.error(t("auth.resetRequestFailed"));
      return;
    }
    setSent(true);
    startCooldown();
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="max-w-sm w-full bg-white dark:bg-navy-dark border rounded-lg p-8">
        {sent ? (
          <div className="text-center">
            <h1 className="text-xl font-bold mb-2">{t("auth.checkYourEmail")}</h1>
            <p className="text-gray-600 dark:text-gray-300 text-sm mb-4">{t("adminForgotPassword.ifStaffAccountExists", { email })}</p>
            <button
              onClick={handleSubmit}
              disabled={cooldown > 0 || loading}
              className="text-navy text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {cooldown > 0 ? t("auth.resendAvailableIn", { seconds: cooldown }) : loading ? t("auth.sendingResetLink") : t("auth.resendLink")}
            </button>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-4">
              <Link to="/login" className="text-navy font-medium">
                {t("auth.backToLogin")}
              </Link>
            </p>
          </div>
        ) : (
          <>
            <h1 className="text-xl font-bold mb-1">{t("auth.forgotPasswordTitle")}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{t("adminForgotPassword.description")}</p>
            <form onSubmit={handleSubmit} className="space-y-3">
              <input
                type="email"
                placeholder={t("auth.email")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full border rounded-md px-3 py-2 text-sm"
              />
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-navy text-white py-2.5 rounded-md font-medium hover:bg-navy-dark disabled:opacity-60"
              >
                {loading ? t("auth.sendingResetLink") : t("auth.sendResetLink")}
              </button>
            </form>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-4">
              <Link to="/login" className="text-navy font-medium">
                {t("auth.backToLogin")}
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
