import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useMerchant } from "../lib/MerchantContext";

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function StoreSettings() {
  const { merchant, store, refresh } = useMerchant();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [status, setStatus] = useState("draft");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (store) {
      setName(store.name);
      setDescription(store.description ?? "");
      setLogoUrl(store.logo_url ?? "");
      setStatus(store.status);
    }
  }, [store]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!merchant) return;
    setSaving(true);
    setMessage(null);

    if (store) {
      await supabase.from("stores").update({ name, description, logo_url: logoUrl || null, status }).eq("id", store.id);
    } else {
      await supabase.from("stores").insert({
        merchant_id: merchant.id,
        name,
        slug: slugify(name),
        description,
        logo_url: logoUrl || null,
        status: "active",
      });
    }

    await refresh();
    setSaving(false);
    setMessage("Saved.");
  }

  return (
    <div className="max-w-md">
      <h1 className="text-xl font-bold mb-4">Store Settings</h1>
      <form onSubmit={handleSave} className="bg-white border rounded-lg p-4 space-y-3">
        <div>
          <label className="text-xs font-medium text-gray-500">Store name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full border rounded-md px-3 py-2 text-sm mt-1"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full border rounded-md px-3 py-2 text-sm mt-1"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500">Logo URL</label>
          <input
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            className="w-full border rounded-md px-3 py-2 text-sm mt-1"
          />
        </div>
        {store && (
          <div>
            <label className="text-xs font-medium text-gray-500">Store status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm mt-1">
              <option value="active">Active</option>
              <option value="paused">Paused</option>
            </select>
          </div>
        )}
        {message && <p className="text-emerald-700 text-sm">{message}</p>}
        <button
          type="submit"
          disabled={saving}
          className="bg-gray-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-800 disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </form>
    </div>
  );
}
