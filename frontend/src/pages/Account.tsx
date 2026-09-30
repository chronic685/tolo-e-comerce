import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MapPin, Heart, Bell, LifeBuoy, LogOut, PartyPopper, ScrollText } from "lucide-react";
import { LanguageSwitcher, Skeleton, ThemeToggle, toast, useTranslation } from "@tolo/ui";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";

interface ReferralReward {
  code: string | null;
  discount_kind: "percent" | "fixed";
  amount: number;
  usage_count: number;
  usage_limit: number | null;
}

export function Account() {
  const { user, signOut } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

  const [referralsEnabled, setReferralsEnabled] = useState(false);
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [referredSignups, setReferredSignups] = useState(0);
  const [successfulReferrals, setSuccessfulReferrals] = useState(0);
  const [rewards, setRewards] = useState<ReferralReward[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("full_name, phone")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        setFullName(data?.full_name ?? "");
        setPhone(data?.phone ?? "");
      });
  }, [user]);

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

  useEffect(() => {
    if (!user || !referralsEnabled) return;

    supabase
      .from("profiles")
      .select("referral_code")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => setReferralCode(data?.referral_code ?? null));

    // profiles_select_own_or_staff RLS only lets a customer read their own
    // row directly — "people I referred" are other customers' rows, so this
    // goes through my_referral_stats() (security definer, aggregate-only;
    // migration 0047) instead of a plain profiles query.
    supabase
      .rpc("my_referral_stats")
      .single()
      .then(({ data }) => {
        const stats = data as { referred_signups: number; successful_referrals: number } | null;
        setReferredSignups(stats?.referred_signups ?? 0);
        setSuccessfulReferrals(stats?.successful_referrals ?? 0);
      });

    supabase
      .from("discount_rules")
      .select("code, discount_kind, amount, usage_count, usage_limit")
      .eq("reward_for_customer_id", user.id)
      .eq("is_active", true)
      .then(({ data }) => {
        const unused = ((data as ReferralReward[]) ?? []).filter((r) => r.usage_limit == null || r.usage_count < r.usage_limit);
        setRewards(unused);
      });
  }, [user, referralsEnabled]);

  const referralLink = referralCode ? `${window.location.origin}/signup?ref=${referralCode}` : null;

  async function handleSignOut() {
    await signOut();
    navigate("/");
  }

  async function handleCopyLink() {
    if (!referralLink) return;
    await navigator.clipboard.writeText(referralLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    const { error } = await supabase.from("profiles").update({ full_name: fullName, phone }).eq("id", user.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("Saved. This phone number will be used automatically at checkout.");
  }

  return (
    <div className="max-w-sm">
      <h1 className="text-xl font-bold mb-1">Account</h1>
      <p className="text-sm text-gray-500 mb-4">{user?.email}</p>
      <form onSubmit={handleSave} className="bg-white border rounded-lg p-4 space-y-3">
        <div>
          <label className="text-xs font-medium text-gray-500">Full name</label>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full border rounded-md px-3 py-2 text-sm mt-1"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500">Phone number</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+2519..."
            className="w-full border rounded-md px-3 py-2 text-sm mt-1"
          />
          <p className="text-xs text-gray-400 mt-1">Used automatically for delivery — you won't be asked again at checkout.</p>
        </div>
        <button
          type="submit"
          disabled={saving}
          className="bg-navy text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-navy-dark disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </form>

      {referralsEnabled && (
        <div className="bg-white border rounded-lg mt-4 p-4">
          <h2 className="font-medium mb-1">Refer a friend</h2>
          <p className="text-xs text-gray-500 mb-3">
            Share your link — when a friend signs up and places their first order, you'll get a one-time discount code.
          </p>

          {referralCode ? (
            <>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={referralLink ?? ""}
                  onClick={(e) => e.currentTarget.select()}
                  className="flex-1 border rounded-md px-3 py-2 text-sm bg-gray-50"
                />
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="border-2 border-navy text-navy px-3 py-2 rounded-md text-sm font-medium hover:bg-navy-50 flex-shrink-0"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                Or share your code: <span className="font-mono font-medium text-gray-600">{referralCode}</span>
              </p>

              <p className="text-sm mt-3">
                <span className="font-semibold">{successfulReferrals}</span> successful referral{successfulReferrals === 1 ? "" : "s"}
                {referredSignups > successfulReferrals && (
                  <span className="text-gray-500"> ({referredSignups} signed up so far)</span>
                )}
              </p>

              {rewards.length > 0 && (
                <div className="mt-3 pt-3 border-t space-y-1">
                  {rewards.map((r) => (
                    <p key={r.code} className="text-sm text-emerald-700 flex items-start gap-1.5">
                      <PartyPopper className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <span>
                        You earned {r.discount_kind === "percent" ? `${r.amount}% off` : `${r.amount} ETB off`} — use code{" "}
                        <span className="font-mono font-medium">{r.code}</span> at checkout.
                      </span>
                    </p>
                  ))}
                </div>
              )}
            </>
          ) : (
            <Skeleton className="h-9 w-full" />
          )}
        </div>
      )}

      <div className="bg-white border rounded-lg mt-4 divide-y">
        <Link to="/locations" className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-gray-50">
          <MapPin className="w-4 h-4 text-gray-400" />
          {t("account.savedLocations")}
        </Link>
        <Link to="/favorites" className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-gray-50">
          <Heart className="w-4 h-4 text-gray-400" />
          {t("account.favorites")}
        </Link>
        <Link to="/notifications" className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-gray-50">
          <Bell className="w-4 h-4 text-gray-400" />
          {t("account.notifications")}
        </Link>
        <Link to="/support" className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-gray-50">
          <LifeBuoy className="w-4 h-4 text-gray-400" />
          {t("account.support")}
        </Link>
      </div>

      {/* This app has no hamburger/slide-out mobile menu -- the bottom
          tab bar (Layout.tsx) is the whole mobile nav -- so the language
          switcher's "mobile menu" presence (Group 5, item 2) lives here
          instead, the natural settings surface for a bottom-tab-bar app. */}
      <div className="bg-white dark:bg-navy-dark border dark:border-white/10 rounded-lg mt-4 px-4 py-3 flex items-center justify-between">
        <span className="text-sm text-gray-700 dark:text-gray-300">{t("account.language")}</span>
        <LanguageSwitcher variant="full" />
      </div>

      <div className="bg-white dark:bg-navy-dark border dark:border-white/10 rounded-lg mt-4 px-4 py-3 flex items-center justify-between">
        <span className="text-sm text-gray-700 dark:text-gray-300">{t("account.theme")}</span>
        <ThemeToggle variant="full" className="dark:text-gray-300" />
      </div>

      <div className="bg-white border rounded-lg mt-4 divide-y">
        <Link to="/legal/terms" className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-gray-50">
          <ScrollText className="w-4 h-4 text-gray-400" />
          {t("legal.termsTitle")}
        </Link>
        <Link to="/legal/privacy" className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-gray-50">
          <ScrollText className="w-4 h-4 text-gray-400" />
          {t("legal.privacyTitle")}
        </Link>
        <Link to="/legal/refund-policy" className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-gray-50">
          <ScrollText className="w-4 h-4 text-gray-400" />
          {t("legal.refundPolicyTitle")}
        </Link>
      </div>

      <button
        onClick={handleSignOut}
        className="flex items-center gap-3 px-4 py-3 text-sm text-red-600 hover:bg-red-50 bg-white border rounded-lg mt-4 w-full"
      >
        <LogOut className="w-4 h-4" />
        {t("common.signOut")}
      </button>
    </div>
  );
}
