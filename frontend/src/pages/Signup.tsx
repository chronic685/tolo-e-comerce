import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast, useTranslation } from "@tolo/ui";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";

export function Signup() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Pre-filled from a shared referral link (?ref=CODE, Account.tsx's "Refer
  // a friend" link) but still a plain editable field — someone who got a
  // code read aloud rather than a link can type it in too.
  const [referralCode, setReferralCode] = useState(searchParams.get("ref") ?? "");
  const [referralsEnabled, setReferralsEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    supabase
      .from("system_settings")
      .select("value")
      .eq("key", "customer_features")
      .maybeSingle()
      .then(({ data }) => {
        const features = data?.value as { referrals_enabled?: boolean } | null;
        setReferralsEnabled(features?.referrals_enabled ?? false);
      });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await signUp(email, password, fullName, referralsEnabled ? referralCode.trim() : undefined);
    setLoading(false);
    if (error) {
      toast.error(error);
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="max-w-sm mx-auto mt-8 text-center">
        <h1 className="text-xl font-bold mb-2">{t("auth.checkYourEmail")}</h1>
        <p className="text-gray-600 dark:text-gray-300 text-sm">
          {t("auth.confirmationSentTo", { email })}{" "}
          <button onClick={() => navigate("/login")} className="text-navy font-medium">
            {t("nav.signIn").toLowerCase()}
          </button>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-sm mx-auto mt-8">
      <h1 className="text-xl font-bold mb-4">{t("auth.createAccount")}</h1>
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
        {referralsEnabled && (
          <input
            placeholder={t("auth.referralCodeOptional")}
            value={referralCode}
            onChange={(e) => setReferralCode(e.target.value)}
            className="w-full border rounded-md px-3 py-2 text-sm uppercase placeholder:normal-case"
          />
        )}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-navy text-white py-2.5 rounded-md font-medium hover:bg-navy-dark disabled:opacity-60"
        >
          {loading ? t("auth.creatingAccount") : t("auth.signup")}
        </button>
      </form>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-4">
        {t("auth.haveAccount")}{" "}
        <Link to="/login" className="text-navy font-medium">
          {t("nav.signIn")}
        </Link>
      </p>
    </div>
  );
}
