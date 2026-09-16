import { useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { useMerchant } from "../lib/MerchantContext";

export function MerchantApplication() {
  const { user } = useAuth();
  const { refresh } = useMerchant();

  const [form, setForm] = useState({ business_name: "", business_category: "", phone: "", location: "" });
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (!agreed) {
      setError("You must accept the merchant agreement to continue.");
      return;
    }
    setSubmitting(true);
    setError(null);

    const { error } = await supabase.from("merchants").insert({
      owner_id: user.id,
      business_name: form.business_name,
      business_category: form.business_category,
      phone: form.phone,
      email: user.email,
      location: form.location,
      agreement_accepted: true,
    });

    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    await refresh();
  }

  return (
    <div className="max-w-md mx-auto mt-12 bg-white border rounded-lg p-6">
      <h1 className="text-lg font-bold mb-1">Become a Tolo Merchant</h1>
      <p className="text-sm text-gray-500 mb-4">
        Submit your business details. Tolo will review and approve your account before your store goes live.
      </p>
      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          placeholder="Business name"
          value={form.business_name}
          onChange={(e) => setForm({ ...form, business_name: e.target.value })}
          required
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
        <input
          placeholder="Business category (e.g. Electronics)"
          value={form.business_category}
          onChange={(e) => setForm({ ...form, business_category: e.target.value })}
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
        <input
          placeholder="Phone"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
        <input
          placeholder="Location"
          value={form.location}
          onChange={(e) => setForm({ ...form, location: e.target.value })}
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          I agree to the Tolo merchant terms and commission structure.
        </label>
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-gray-900 text-white py-2.5 rounded-md font-medium hover:bg-gray-800 disabled:opacity-60"
        >
          {submitting ? "Submitting..." : "Submit application"}
        </button>
      </form>
    </div>
  );
}
