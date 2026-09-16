import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useMerchant } from "../lib/MerchantContext";
import { getCurrentLocation } from "../lib/geolocation";

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
  const [pickupAddress, setPickupAddress] = useState("");
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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

    if (store) {
      await supabase.from("stores").update({ ...payload, status }).eq("id", store.id);
    } else {
      await supabase.from("stores").insert({ merchant_id: merchant.id, slug: slugify(name), status: "active", ...payload });
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

        <div className="pt-2 border-t">
          <label className="text-xs font-medium text-gray-500">Pickup location</label>
          <p className="text-xs text-gray-400 mb-2">
            Used automatically as the pickup point for every delivery — you won't be asked again per order.
          </p>
          <button
            type="button"
            onClick={handleUseCurrentLocation}
            disabled={locating}
            className="w-full border-2 border-emerald-600 text-emerald-700 rounded-md px-3 py-2 text-sm font-medium hover:bg-emerald-50 disabled:opacity-60 mb-2"
          >
            {locating ? "Getting your location..." : "📍 Use my current location"}
          </button>
          {locationError && <p className="text-red-600 text-xs mb-2">{locationError}</p>}
          {latitude && (
            <p className="text-xs text-emerald-700 bg-emerald-50 rounded-md px-3 py-2 mb-2">
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
          className="bg-gray-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-800 disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </form>
    </div>
  );
}
