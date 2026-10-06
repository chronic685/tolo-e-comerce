import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import {
  toast,
  translateServerError,
  useCategoryName,
  useTranslation,
} from "@tolo/ui";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { useMerchant } from "../lib/MerchantContext";
import { saveMerchantContact } from "../lib/merchantContact";
import type { Category } from "../types";

const REQUIRED_DOCS = [
  { type: "trade_license", labelKey: "merchantApplication.docs.trade_license" },
  { type: "vat_certificate", labelKey: "merchantApplication.docs.vat_certificate" },
  { type: "tin_certificate", labelKey: "merchantApplication.docs.tin_certificate" },
  { type: "identification", labelKey: "merchantApplication.docs.identification" },
];

export function MerchantApplication() {
  const { t } = useTranslation();
  const categoryName = useCategoryName();
  const { user } = useAuth();
  const { refresh } = useMerchant();

  const [form, setForm] = useState({
    business_name: "",
    category_id: "",
    tin: "",
    phone: "",
    city: "",
    sub_city: "",
    woreda: "",
    landmark: "",
    owner_full_name: "",
    owner_phone: "",
    owner_email: "",
  });
  const [categories, setCategories] = useState<Category[]>([]);
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // The merchant row is created first, then its TIN is set (set_merchant_tin, migration 0094). If the TIN is
  // refused (already registered), the merchant exists but is not "done": the form stays up so the TIN can be
  // corrected and retried against the same merchant instead of creating a second one.
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [tinSaved, setTinSaved] = useState(false);
  const [uploadedTypes, setUploadedTypes] = useState<Set<string>>(new Set());
  const [uploadingType, setUploadingType] = useState<string | null>(null);

  // The same admin-managed list the marketplace and the product form use.
  useEffect(() => {
    supabase
      .from("categories")
      .select("id, name, name_am, slug")
      .eq("is_active", true)
      .order("sort_order")
      .order("name")
      .then(({ data }) => setCategories(data ?? []));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (!agreed) {
      toast.error(t("merchantApplication.agreementRequired"));
      return;
    }
    // A pick from the categories list, stored as a link (merchants.category_id,
    // migration 0090), never as typed text. business_category is legacy and not written.
    if (!categories.some((c) => c.id === form.category_id)) return;
    if (!/^[0-9]{10}$/.test(form.tin)) {
      toast.error(t("merchantApplication.tinInvalid"));
      return;
    }
    setSubmitting(true);

    if (merchantId) {
      await saveContactAndTin(merchantId);
      return;
    }

    const { data, error } = await supabase
      .from("merchants")
      .insert({
        owner_id: user.id,
        business_name: form.business_name,
        category_id: form.category_id,
        location: [form.city, form.sub_city].filter(Boolean).join(", ") || null,
        city: form.city || null,
        sub_city: form.sub_city || null,
        woreda: form.woreda || null,
        landmark: form.landmark || null,
        agreement_accepted: true,
      })
      .select("id")
      .single();

    if (error) {
      setSubmitting(false);
      toast.error(translateServerError(error.message, t));
      return;
    }
    setMerchantId(data.id);
    await saveContactAndTin(data.id);
  }

  // Contact details live in merchant_private (migration 0099), not on the publicly readable merchants row; saveMerchantContact falls back to
  // the old columns while that table does not exist yet, so this works before and after the migration.
  async function saveContactAndTin(id: string) {
    const { error: contactError } = await saveMerchantContact(id, {
      phone: form.phone,
      email: user?.email ?? null,
      owner_full_name: form.owner_full_name || null,
      owner_phone: form.owner_phone || null,
      owner_email: form.owner_email || user?.email || null,
    });
    if (contactError) {
      setSubmitting(false);
      toast.error(translateServerError(contactError.message, t));
      return;
    }
    const { error } = await supabase.rpc("set_merchant_tin", { p_merchant_id: id, p_tin: form.tin });
    setSubmitting(false);
    if (error) {
      toast.error(translateServerError(error.message, t));
      return;
    }
    setTinSaved(true);
  }

  async function handleUpload(docType: string, file: File) {
    if (!merchantId) return;
    setUploadingType(docType);

    const path = `${merchantId}/${docType}-${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from("merchant-documents").upload(path, file);

    if (uploadError) {
      setUploadingType(null);
      toast.error(translateServerError(uploadError.message, t));
      return;
    }

    const { error: insertError } = await supabase.from("merchant_documents").insert({
      merchant_id: merchantId,
      doc_type: docType,
      file_url: path,
      file_name: file.name,
      status: "uploaded",
    });

    setUploadingType(null);
    if (insertError) {
      toast.error(translateServerError(insertError.message, t));
      return;
    }
    setUploadedTypes((prev) => new Set(prev).add(docType));
  }

  if (merchantId && tinSaved) {
    return (
      <div className="max-w-md mx-auto mt-12 bg-white dark:bg-navy-dark border rounded-lg p-6">
        <h1 className="text-lg font-bold mb-1">{t("merchantApplication.uploadDocsTitle")}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{t("merchantApplication.uploadDocsDescription")}</p>
        <div className="space-y-3">
          {REQUIRED_DOCS.map((doc) => (
            <div key={doc.type} className="flex items-center justify-between border rounded-md p-3">
              <span className="text-sm">{t(doc.labelKey)}</span>
              {uploadedTypes.has(doc.type) ? (
                <span className="text-xs text-emerald-700 font-medium inline-flex items-center gap-1">
                  {t("merchantApplication.uploaded")}
                  <CheckCircle2 className="w-4 h-4" />
                </span>
              ) : (
                <label className="text-xs text-gray-700 dark:text-gray-300 border rounded-md px-2 py-1 cursor-pointer hover:bg-gray-50 dark:bg-white/5">
                  {uploadingType === doc.type ? t("common.uploading") : t("merchantApplication.chooseFile")}
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.webp"
                    className="hidden"
                    disabled={uploadingType !== null}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleUpload(doc.type, file);
                    }}
                  />
                </label>
              )}
            </div>
          ))}
        </div>
        <button
          onClick={() => refresh()}
          className="w-full bg-navy text-white py-2.5 rounded-md font-medium hover:bg-navy-dark mt-4"
        >
          {t("merchantApplication.doneSubmitForReview")}
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto mt-12 bg-white dark:bg-navy-dark border rounded-lg p-6">
      <h1 className="text-lg font-bold mb-1">{t("merchantApplication.becomeAMerchantTitle")}</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{t("merchantApplication.becomeAMerchantDescription")}</p>
      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          placeholder={t("merchantApplication.businessName")}
          value={form.business_name}
          onChange={(e) => setForm({ ...form, business_name: e.target.value })}
          required
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
        <label className="block">
          <input
            placeholder={t("merchantApplication.tin")}
            value={form.tin}
            onChange={(e) => setForm({ ...form, tin: e.target.value.replace(/\D/g, "").slice(0, 10) })}
            inputMode="numeric"
            autoComplete="off"
            required
            minLength={10}
            maxLength={10}
            pattern="[0-9]{10}"
            title={t("merchantApplication.tinHint")}
            className="w-full border rounded-md px-3 py-2 text-sm"
          />
          <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1">{t("merchantApplication.tinHint")}</span>
        </label>
        <select
          value={form.category_id}
          onChange={(e) => setForm({ ...form, category_id: e.target.value })}
          required
          className="w-full border rounded-md px-3 py-2 text-sm"
        >
          <option value="">{t("merchantApply.categoryPlaceholder")}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {categoryName(c)}
            </option>
          ))}
        </select>
        <input
          placeholder={t("merchantApplication.businessPhone")}
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
        <div className="grid grid-cols-3 gap-2">
          <input
            placeholder={t("checkout.city")}
            value={form.city}
            onChange={(e) => setForm({ ...form, city: e.target.value })}
            className="w-full border rounded-md px-3 py-2 text-sm"
          />
          <input
            placeholder={t("merchantApplication.subCity")}
            value={form.sub_city}
            onChange={(e) => setForm({ ...form, sub_city: e.target.value })}
            className="w-full border rounded-md px-3 py-2 text-sm"
          />
          <input
            placeholder={t("merchantApplication.woreda")}
            value={form.woreda}
            onChange={(e) => setForm({ ...form, woreda: e.target.value })}
            className="w-full border rounded-md px-3 py-2 text-sm"
          />
        </div>
        <input
          placeholder={t("checkout.landmarkOptional")}
          value={form.landmark}
          onChange={(e) => setForm({ ...form, landmark: e.target.value })}
          className="w-full border rounded-md px-3 py-2 text-sm"
        />

        <div className="pt-2 border-t">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">{t("merchantApplication.ownerInformation")}</p>
          <div className="space-y-2">
            <input
              placeholder={t("merchantApplication.ownerFullName")}
              value={form.owner_full_name}
              onChange={(e) => setForm({ ...form, owner_full_name: e.target.value })}
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
            <input
              placeholder={t("merchantApplication.ownerPhone")}
              value={form.owner_phone}
              onChange={(e) => setForm({ ...form, owner_phone: e.target.value })}
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
            <input
              placeholder={t("merchantApplication.ownerEmail")}
              value={form.owner_email}
              onChange={(e) => setForm({ ...form, owner_email: e.target.value })}
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          {t("merchantApplication.agreeToTerms")}
        </label>
        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-navy text-white py-2.5 rounded-md font-medium hover:bg-navy-dark disabled:opacity-60"
        >
          {submitting ? t("support.submitting") : t("merchantApplication.continueToDocuments")}
        </button>
      </form>
    </div>
  );
}
