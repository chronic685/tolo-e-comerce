import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast, translateAuthError, useTranslation } from "@tolo/ui";
import { useAuth } from "../lib/AuthContext";

export function Signup() {
  const { t } = useTranslation();
  const { signUp } = useAuth();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await signUp(email, password, fullName);
    setLoading(false);
    if (error) {
      toast.error(translateAuthError(error, t));
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="max-w-sm mx-auto mt-16 text-center">
        <h1 className="text-xl font-bold mb-2">{t("auth.checkYourEmail")}</h1>
        <p className="text-gray-600 dark:text-gray-300 text-sm">
          {t("merchantSignup.confirmEmailPrefix")}{" "}
          <button onClick={() => navigate("/login")} className="text-navy font-medium underline">
            {t("merchantSignup.signInLink")}
          </button>{" "}
          {t("merchantSignup.confirmEmailSuffix")}
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-sm mx-auto mt-16">
      <h1 className="text-xl font-bold mb-4">{t("merchantSignup.createAccountTitle")}</h1>
      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          placeholder={t("auth.fullName")}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          required
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
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
          minLength={6}
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-navy text-white py-2.5 rounded-md font-medium hover:bg-navy-dark disabled:opacity-60"
        >
          {loading ? t("auth.creatingAccount") : t("merchantSignup.continue")}
        </button>
      </form>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-4">
        {t("auth.haveAccount")}{" "}
        <Link to="/login" className="text-navy font-medium underline">
          {t("nav.signIn")}
        </Link>
      </p>
    </div>
  );
}
