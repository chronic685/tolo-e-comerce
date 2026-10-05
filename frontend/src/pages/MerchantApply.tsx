import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock } from "lucide-react";
import { SkeletonPage, useCategoryName, useTranslation } from "@tolo/ui";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { closeApp, isEmbedMode } from "../lib/appBridge";
import { isValidTin, LICENSE_BUCKET, LICENSE_UPLOAD_ENABLED, licensePath, submitErrorKey, validateLicenseFile } from "../lib/merchantApplication";
import type { Category } from "../types";

interface Application {
  id: string;
  status: "pending" | "approved" | "rejected";
  business_name: string;
  admin_note: string | null;
  created_at: string;
}

// "Apply to become a merchant", opened by the Tolo app through the same
// handoff as sign-in: /auth/handoff?code=<code>&embed=app&next=/merchant/apply
// (docs/integration/tolo-app.md). The phone is never asked for here -- it's
// the one tolo-app-login already verified and linked to this account
// (tolo_phone_links), which submit_merchant_application() reads server-side.
export function MerchantApply() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const categoryName = useCategoryName();
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<Category[]>([]);
  const [latest, setLatest] = useState<Application | null>(null);
  const [submitted, setSubmitted] = useState<Application | null>(null);
  const [verifiedPhone, setVerifiedPhone] = useState<string | null>(null);

  const [businessName, setBusinessName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [address, setAddress] = useState("");
  const [tin, setTin] = useState("");
  const [license, setLicense] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [{ data: cats }, { data: apps }, { data: link }] = await Promise.all([
        supabase.from("categories").select("id, name, name_am, slug, icon, color").eq("is_active", true).order("sort_order").order("name"),
        // RLS only ever returns this session's own applications.
        supabase
          .from("merchant_applications")
          .select("id, status, business_name, admin_note, created_at")
          .order("created_at", { ascending: false })
          .limit(1),
        // Readable only by its own account; absent if this account never
        // signed in through the Tolo app.
        supabase.from("tolo_phone_links").select("phone").maybeSingle(),
      ]);
      setCategories((cats as Category[]) ?? []);
      setLatest(((apps as Application[]) ?? [])[0] ?? null);
      setVerifiedPhone((link as { phone: string } | null)?.phone ?? null);
      setLoading(false);
    })();
  }, [user]);

  const preview = useMemo(() => (license ? URL.createObjectURL(license) : null), [license]);
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  function handleFile(file: File | undefined) {
    setError(null);
    if (!file) return;
    const fileError = validateLicenseFile(file);
    if (fileError) {
      setLicense(null);
      setError(t(fileError));
      return;
    }
    setLicense(file);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !isValidTin(tin) || (LICENSE_UPLOAD_ENABLED && !license)) return;
    setError(null);
    setSubmitting(true);

    // The photo is optional now (off by default): only uploaded, and only sent, when the switch is on.
    let path: string | null = null;
    if (LICENSE_UPLOAD_ENABLED && license) {
      path = licensePath(user.id, license, crypto.randomUUID());
      const { error: uploadError } = await supabase.storage.from(LICENSE_BUCKET).upload(path, license, { contentType: license.type });
      if (uploadError) {
        setSubmitting(false);
        setError(t("merchantApply.error.upload"));
        return;
      }
    }

    const { data, error: submitError } = await supabase
      .rpc("submit_merchant_application", {
        p_business_name: businessName,
        p_category_id: categoryId,
        p_address: address,
        p_tin: tin,
        ...(path ? { p_license_photo_url: path } : {}),
      })
      .single();
    setSubmitting(false);
    if (submitError || !data) {
      setError(t(submitErrorKey(submitError?.message)));
      return;
    }
    setSubmitted(data as Application);
  }

  if (loading) return <SkeletonPage />;

  if (!verifiedPhone) {
    return (
      <StatusCard title={t("merchantApply.noPhone.title")}>
        <p>{t("merchantApply.noPhone.body")}</p>
      </StatusCard>
    );
  }

  if (submitted) {
    return (
      <StatusCard icon={<CheckCircle2 className="w-10 h-10 text-emerald-600" />} title={t("merchantApply.submitted.title")}>
        <p>{t("merchantApply.submitted.body", { business: submitted.business_name })}</p>
        <DoneButton />
      </StatusCard>
    );
  }

  if (latest?.status === "pending") {
    return (
      <StatusCard icon={<Clock className="w-10 h-10 text-amber-500" />} title={t("merchantApply.pending.title")}>
        <p>{t("merchantApply.pending.body", { business: latest.business_name })}</p>
        <DoneButton />
      </StatusCard>
    );
  }

  if (latest?.status === "approved") {
    return (
      <StatusCard icon={<CheckCircle2 className="w-10 h-10 text-emerald-600" />} title={t("merchantApply.approved.title")}>
        <p>{t("merchantApply.approved.body")}</p>
        <DoneButton />
      </StatusCard>
    );
  }

  const inputClass = "w-full border rounded-md px-3 py-2 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100";

  return (
    <div className="max-w-md mx-auto">
      <h1 className="text-xl font-bold mb-1 dark:text-gray-100">{t("merchantApply.title")}</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{t("merchantApply.intro")}</p>

      {latest?.status === "rejected" && (
        <div className="border border-red-200 bg-red-50 dark:bg-red-950/40 dark:border-red-900 rounded-md p-3 mb-4 text-sm">
          <p className="font-medium text-red-800 dark:text-red-300">{t("merchantApply.rejected.title")}</p>
          {latest.admin_note && <p className="text-red-700 dark:text-red-300 mt-1">{latest.admin_note}</p>}
          <p className="text-red-700 dark:text-red-300 mt-1">{t("merchantApply.rejected.reapply")}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <span className="block text-sm font-medium mb-1 dark:text-gray-200">{t("auth.phone")}</span>
          <p className="text-sm text-gray-700 dark:text-gray-300">{verifiedPhone}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">{t("merchantApply.phoneHint")}</p>
        </div>

        <label className="block">
          <span className="block text-sm font-medium mb-1 dark:text-gray-200">{t("merchantApply.businessName")}</span>
          <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} required minLength={2} maxLength={120} className={inputClass} />
        </label>

        <label className="block">
          <span className="block text-sm font-medium mb-1 dark:text-gray-200">{t("merchantApply.category")}</span>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required className={inputClass}>
            <option value="">{t("merchantApply.categoryPlaceholder")}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {categoryName(c)}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="block text-sm font-medium mb-1 dark:text-gray-200">{t("merchantApply.address")}</span>
          <textarea value={address} onChange={(e) => setAddress(e.target.value)} required minLength={5} maxLength={300} rows={2} className={inputClass} />
        </label>

        <label className="block">
          <span className="block text-sm font-medium mb-1 dark:text-gray-200">{t("merchantApply.tin")}</span>
          <input
            value={tin}
            onChange={(e) => setTin(e.target.value.replace(/\D/g, "").slice(0, 10))}
            inputMode="numeric"
            autoComplete="off"
            required
            minLength={10}
            maxLength={10}
            pattern="[0-9]{10}"
            title={t("merchantApply.tinHint")}
            className={inputClass}
          />
          <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1">{t("merchantApply.tinHint")}</span>
        </label>

        {LICENSE_UPLOAD_ENABLED && (
          <>
            <label className="block">
              <span className="block text-sm font-medium mb-1 dark:text-gray-200">{t("merchantApply.license")}</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => handleFile(e.target.files?.[0])}
                required
                className="block w-full text-sm dark:text-gray-300"
              />
              <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1">{t("merchantApply.licenseHint")}</span>
            </label>
            {preview && <img src={preview} alt={t("merchantApply.license")} className="max-h-48 rounded-md border dark:border-white/20" />}
          </>
        )}

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={submitting || !isValidTin(tin) || (LICENSE_UPLOAD_ENABLED && !license)}
          className="w-full bg-navy text-white py-2.5 rounded-md font-medium hover:bg-navy-dark disabled:opacity-60"
        >
          {submitting ? t("merchantApply.submitting") : t("merchantApply.submit")}
        </button>
      </form>
    </div>
  );
}

function StatusCard({ icon, title, children }: { icon?: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="max-w-md mx-auto mt-8 text-center bg-white dark:bg-navy-dark border dark:border-white/10 rounded-lg p-6 space-y-3 text-sm text-gray-600 dark:text-gray-300">
      {icon && <div className="flex justify-center">{icon}</div>}
      <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">{title}</h1>
      {children}
    </div>
  );
}

// In the app's WebView, "Done" hands control back to the app; on the
// plain website there's nothing to close, so it isn't shown.
function DoneButton() {
  const { t } = useTranslation();
  if (!isEmbedMode()) return null;
  return (
    <button onClick={closeApp} className="bg-navy text-white px-6 py-2 rounded-md font-medium hover:bg-navy-dark">
      {t("merchantApply.done")}
    </button>
  );
}
