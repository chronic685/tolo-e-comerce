import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast, translateServerError, useTranslation } from "@tolo/ui";
import { useAuth } from "../lib/AuthContext";

export function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const from = (location.state as { from?: Location })?.from?.pathname ?? "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await signIn(email, password);
    setLoading(false);
    if (error) {
      toast.error(translateServerError(error, t));
      return;
    }
    navigate(from, { replace: true });
  }

  return (
    <div className="max-w-sm mx-auto mt-8">
      <h1 className="text-xl font-bold mb-4">{t("nav.signIn")}</h1>
      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          type="email"
          placeholder={t("auth.email")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
        <input
          type="password"
          placeholder={t("auth.password")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
        <div className="text-right">
          <Link to="/forgot-password" className="text-xs text-navy font-medium">
            {t("auth.forgotPassword")}
          </Link>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-navy text-white py-2.5 rounded-md font-medium hover:bg-navy-dark disabled:opacity-60"
        >
          {loading ? t("auth.signingIn") : t("nav.signIn")}
        </button>
      </form>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-4">
        {t("auth.noAccount")}{" "}
        <Link to="/signup" className="text-navy font-medium">
          {t("auth.signup")}
        </Link>
      </p>
    </div>
  );
}
