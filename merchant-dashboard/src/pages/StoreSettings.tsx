import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useMerchant } from "../lib/MerchantContext";
import { getCurrentLocation } from "../lib/geolocation";
import type { Store } from "../types";

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function StoreSettings() {
  const { merchant, store, setStoreLocal } = useMerchant();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [status, setStatus] = useState("draft");
  const [pickupAddress, setPickupAddress] = useState("");
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);

  useEffect(() => {
    if (store) {
      setName(store.name);
      setDescription(store.description ?? "");
      setLogoUrl(store.logo_url ?? "");
      setStatus(store.status);
      setPickupAddress(store.pickup_address ?? "");
      setLatitude(store.latitude ?? null);
      setLongitude(store.longitude ?? null);
    }
  }, [store]);

  async function handleUseCurrentLocation() {
    setLocating(true);
    setLocationError(null);
    try {
      const loc = await getCurrentLocation();
      setLatitude(loc.latitude);
      setLongitude(loc.longitude);
      setPickupAddress(loc.address || pickupAddress);
    } catch (err) {
      setLocationError(err instanceof Error ? err.message : "Could not get your location.");
    } finally {
      setLocating(false);
    }
  }

  // Same bucket, path convention, and upload flow ProductForm.tsx already
  // uses (product-images, `${merchant.id}/...`) rather than a new bucket —
  // the existing storage RLS already scopes uploads to the calling
  // merchant's own folder, so nothing else needs to change for this to work.
  async function handleLogoUpload(file: File) {
    if (!merchant) return;
    setUploadingLogo(true);
    setLogoError(null);

    const path = `${merchant.id}/logo-${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from("product-images").upload(path, file);

    setUploadingLogo(false);
    if (uploadError) {
      setLogoError(uploadError.message);
      return;
    }

    const { data } = supabase.storage.from("product-images").getPublicUrl(path);
    setLogoUrl(data.publicUrl);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!merchant) return;
    setSaving(true);
    setMessage(null);

    const payload = {
      name,
      description,
      logo_url: logoUrl || null,
      pickup_address: pickupAddress || null,
      latitude,
      longitude,
    };

    // Was `await refresh()` -- MerchantContext.refresh() sets loading=true,
    // and MerchantGate.tsx (wrapping every authenticated merchant-dashboard
    // route) blanks the whole app to "Loading..." while that's true, so
    // saving your store name flashed the entire dashboard, not just this
    // page. setStoreLocal() patches the cached store directly with the
    // confirmed row from .select().single() instead.
    const { data, error } = store
      ? await supabase.from("stores").update({ ...payload, status }).eq("id", store.id).select().single()
      : await supabase.from("stores").insert({ merchant_id: merchant.id, slug: slugify(name), status: "active", ...payload }).select().single();

    setSaving(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setStoreLocal(data as Store);
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
          <label className="text-xs font-medium text-gray-500">Shop logo</label>
          <div className="flex items-center gap-3 mt-1">
            {logoUrl ? (
              <img src={logoUrl} alt="" className="w-14 h-14 rounded-full object-cover border flex-shrink-0" />
            ) : (
              <div className="w-14 h-14 rounded-full bg-gray-100 border flex-shrink-0" />
            )}
            <div className="flex gap-2">
              <label className="text-xs text-gray-700 border rounded-md px-3 py-1.5 cursor-pointer hover:bg-gray-50">
                {uploadingLogo ? "Uploading..." : logoUrl ? "Replace" : "Upload"}
                <input
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp"
                  className="hidden"
                  disabled={uploadingLogo}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleLogoUpload(file);
                  }}
                />
              </label>
              {logoUrl && (
                <button
                  type="button"
                  onClick={() => setLogoUrl("")}
                  className="text-xs text-red-600 border border-red-200 rounded-md px-3 py-1.5 hover:bg-red-50"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
          {logoError && <p className="text-red-600 text-xs mt-1">{logoError}</p>}
          <input
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            placeholder="Or paste a photo URL directly"
            className="w-full border rounded-md px-3 py-2 text-sm mt-2"
          />
        </div>

        <div className="pt-2 border-t">
          <label className="text-xs font-medium text-gray-500">Pickup location</label>
          <p className="text-xs text-gray-400 mb-2">
            Used automatically as the pickup point for every delivery — you won't be asked again per order.
          </p>
          <button
            type="button"
            onClick={handleUseCurrentLocation}
            disabled={locating}
            className="w-full border-2 border-navy text-navy rounded-md px-3 py-2 text-sm font-medium hover:bg-navy-50 disabled:opacity-60 mb-2"
          >
            {locating ? "Getting your location..." : "📍 Use my current location"}
          </button>
          {locationError && <p className="text-red-600 text-xs mb-2">{locationError}</p>}
          {latitude && (
            <p className="text-xs text-navy bg-navy-50 rounded-md px-3 py-2 mb-2">
              📍 GPS location set ({latitude.toFixed(5)}, {longitude?.toFixed(5)})
            </p>
          )}
          <input
            value={pickupAddress}
            onChange={(e) => setPickupAddress(e.target.value)}
            placeholder="Pickup address description"
            className="w-full border rounded-md px-3 py-2 text-sm"
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
          className="bg-navy text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-navy-dark disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </form>
    </div>
  );
}
