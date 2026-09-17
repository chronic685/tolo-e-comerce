import { useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { useMerchant } from "../lib/MerchantContext";

const REQUIRED_DOCS = [
  { type: "trade_license", label: "Trade License" },
  { type: "vat_certificate", label: "VAT Certificate" },
  { type: "tin_certificate", label: "TIN Certificate" },
  { type: "identification", label: "Owner Identification" },
];

export function MerchantApplication() {
  const { user } = useAuth();
  const { refresh } = useMerchant();

  const [form, setForm] = useState({
    business_name: "",
    business_category: "",
    business_subcategory: "",
    phone: "",
    city: "",
    sub_city: "",
    woreda: "",
    landmark: "",
    owner_full_name: "",
    owner_phone: "",
    owner_email: "",
  });
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [uploadedTypes, setUploadedTypes] = useState<Set<string>>(new Set());
  const [uploadingType, setUploadingType] = useState<string | null>(null);
  const [docError, setDocError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (!agreed) {
      setError("You must accept the merchant agreement to continue.");
      return;
    }
    setSubmitting(true);
    setError(null);

    const { data, error } = await supabase
      .from("merchants")
      .insert({
        owner_id: user.id,
        business_name: form.business_name,
        business_category: form.business_category,
        business_subcategory: form.business_subcategory || null,
        phone: form.phone,
        email: user.email,
        location: [form.city, form.sub_city].filter(Boolean).join(", ") || null,
        city: form.city || null,
        sub_city: form.sub_city || null,
        woreda: form.woreda || null,
        landmark: form.landmark || null,
        owner_full_name: form.owner_full_name || null,
        owner_phone: form.owner_phone || null,
        owner_email: form.owner_email || user.email,
        agreement_accepted: true,
      })
      .select("id")
      .single();

    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    setMerchantId(data.id);
  }

  async function handleUpload(docType: string, file: File) {
    if (!merchantId) return;
    setUploadingType(docType);
    setDocError(null);

    const path = `${merchantId}/${docType}-${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from("merchant-documents").upload(path, file);

    if (uploadError) {
      setUploadingType(null);
      setDocError(uploadError.message);
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
      setDocError(insertError.message);
      return;
    }
    setUploadedTypes((prev) => new Set(prev).add(docType));
  }

  if (merchantId) {
    return (
      <div className="max-w-md mx-auto mt-12 bg-white border rounded-lg p-6">
        <h1 className="text-lg font-bold mb-1">Upload verification documents</h1>
        <p className="text-sm text-gray-500 mb-4">
          Documents are stored privately — only you and Tolo staff can access them. You can also add these later.
        </p>
        <div className="space-y-3">
          {REQUIRED_DOCS.map((doc) => (
            <div key={doc.type} className="flex items-center justify-between border rounded-md p-3">
              <span className="text-sm">{doc.label}</span>
              {uploadedTypes.has(doc.type) ? (
                <span className="text-xs text-emerald-700 font-medium">Uploaded ✓</span>
              ) : (
                <label className="text-xs text-gray-700 border rounded-md px-2 py-1 cursor-pointer hover:bg-gray-50">
                  {uploadingType === doc.type ? "Uploading..." : "Choose file"}
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
        {docError && <p className="text-red-600 text-sm mt-3">{docError}</p>}
        <button
          onClick={() => refresh()}
          className="w-full bg-navy text-white py-2.5 rounded-md font-medium hover:bg-navy-dark mt-4"
        >
          Done — submit for review
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto mt-12 bg-white border rounded-lg p-6">
      <h1 className="text-lg font-bold mb-1">Become a Tolo Merchant</h1>
      <p className="text-sm text-gray-500 mb-4">
        Submit your business details. Tolo will review your documents and approve your account before your store goes live.
      </p>
      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          placeholder="Business name"
          value={form.business_name}
          onChange={(e) => setForm({ ...form, business_name: e.target.value })}
          required
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            placeholder="Category (e.g. Fashion)"
            value={form.business_category}
            onChange={(e) => setForm({ ...form, business_category: e.target.value })}
            className="w-full border rounded-md px-3 py-2 text-sm"
          />
          <input
            placeholder="Subcategory (e.g. T-Shirts)"
            value={form.business_subcategory}
            onChange={(e) => setForm({ ...form, business_subcategory: e.target.value })}
            className="w-full border rounded-md px-3 py-2 text-sm"
          />
        </div>
        <input
          placeholder="Business phone"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
        <div className="grid grid-cols-3 gap-2">
          <input
            placeholder="City"
            value={form.city}
            onChange={(e) => setForm({ ...form, city: e.target.value })}
            className="w-full border rounded-md px-3 py-2 text-sm"
          />
          <input
            placeholder="Sub-city"
            value={form.sub_city}
            onChange={(e) => setForm({ ...form, sub_city: e.target.value })}
            className="w-full border rounded-md px-3 py-2 text-sm"
          />
          <input
            placeholder="Woreda"
            value={form.woreda}
            onChange={(e) => setForm({ ...form, woreda: e.target.value })}
            className="w-full border rounded-md px-3 py-2 text-sm"
          />
        </div>
        <input
          placeholder="Landmark (optional)"
          value={form.landmark}
          onChange={(e) => setForm({ ...form, landmark: e.target.value })}
          className="w-full border rounded-md px-3 py-2 text-sm"
        />

        <div className="pt-2 border-t">
          <p className="text-xs font-medium text-gray-500 mb-2">Owner information</p>
          <div className="space-y-2">
            <input
              placeholder="Owner full name"
              value={form.owner_full_name}
              onChange={(e) => setForm({ ...form, owner_full_name: e.target.value })}
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
            <input
              placeholder="Owner phone"
              value={form.owner_phone}
              onChange={(e) => setForm({ ...form, owner_phone: e.target.value })}
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
            <input
              placeholder="Owner email"
              value={form.owner_email}
              onChange={(e) => setForm({ ...form, owner_email: e.target.value })}
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          I agree to the Tolo merchant terms and commission structure.
        </label>
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-navy text-white py-2.5 rounded-md font-medium hover:bg-navy-dark disabled:opacity-60"
        >
          {submitting ? "Submitting..." : "Continue to documents"}
        </button>
      </form>
    </div>
  );
}
