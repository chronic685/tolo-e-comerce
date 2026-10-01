import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import { DAY_KEYS, DAY_LABELS, isOpenNowClientSide, toast, type DayKey, type OperatingHours } from "@tolo/ui";
import { supabase } from "../lib/supabase";
import { useMerchant } from "../lib/MerchantContext";
import { getCurrentLocation } from "../lib/geolocation";
import type { Store } from "../types";

const DEFAULT_DAY_HOURS = { open: "09:00", close: "21:00" };

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
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [hours, setHours] = useState<OperatingHours>({});
  const [prepTimeMinutes, setPrepTimeMinutes] = useState("");

  useEffect(() => {
    if (store) {
      setName(store.name);
      setDescription(store.description ?? "");
      setLogoUrl(store.logo_url ?? "");
      setStatus(store.status);
      setPickupAddress(store.pickup_address ?? "");
      setLatitude(store.latitude ?? null);
      setLongitude(store.longitude ?? null);
      setHours(store.operating_hours ?? {});
      setPrepTimeMinutes(store.prep_time_minutes != null ? String(store.prep_time_minutes) : "");
    }
  }, [store]);

  function toggleDay(day: DayKey, open: boolean) {
    setHours((prev) => ({ ...prev, [day]: open ? DEFAULT_DAY_HOURS : null }));
  }

  function setDayTime(day: DayKey, field: "open" | "close", value: string) {
    setHours((prev) => ({ ...prev, [day]: { ...(prev[day] ?? DEFAULT_DAY_HOURS), [field]: value } }));
  }

  async function handleUseCurrentLocation() {
    setLocating(true);
    try {
      const loc = await getCurrentLocation();
      setLatitude(loc.latitude);
      setLongitude(loc.longitude);
      setPickupAddress(loc.address || pickupAddress);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not get your location.");
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

    const path = `${merchant.id}/logo-${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from("product-images").upload(path, file);

    setUploadingLogo(false);
    if (uploadError) {
      toast.error(uploadError.message);
      return;
    }

    const { data } = supabase.storage.from("product-images").getPublicUrl(path);
    setLogoUrl(data.publicUrl);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!merchant) return;
    setSaving(true);

    const payload = {
      name,
      description,
      logo_url: logoUrl || null,
      pickup_address: pickupAddress || null,
      latitude,
      longitude,
      operating_hours: hours,
      prep_time_minutes: prepTimeMinutes.trim() ? Number(prepTimeMinutes) : null,
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
      toast.error(error.message);
      return;
    }
    setStoreLocal(data as Store);
    toast.success("Saved.");
  }

  return (
    <div className="max-w-md">
      <h1 className="text-xl font-bold mb-4">Store Settings</h1>
      <form onSubmit={handleSave} className="bg-white dark:bg-navy-dark border rounded-lg p-4 space-y-3">
        <div>
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Store name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full border rounded-md px-3 py-2 text-sm mt-1"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full border rounded-md px-3 py-2 text-sm mt-1"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Shop logo</label>
          <div className="flex items-center gap-3 mt-1">
            {logoUrl ? (
              <img src={logoUrl} alt="" className="w-14 h-14 rounded-full object-cover border flex-shrink-0" />
            ) : (
              <div className="w-14 h-14 rounded-full bg-gray-100 dark:bg-white/10 border flex-shrink-0" />
            )}
            <div className="flex gap-2">
              <label className="text-xs text-gray-700 dark:text-gray-300 border rounded-md px-3 py-1.5 cursor-pointer hover:bg-gray-50 dark:bg-white/5">
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
          <input
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            placeholder="Or paste a photo URL directly"
            className="w-full border rounded-md px-3 py-2 text-sm mt-2"
          />
        </div>

        <div className="pt-2 border-t">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Pickup location</label>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">
            Used automatically as the pickup point for every delivery — you won't be asked again per order.
          </p>
          <button
            type="button"
            onClick={handleUseCurrentLocation}
            disabled={locating}
            className="w-full border-2 border-navy text-navy rounded-md px-3 py-2 text-sm font-medium hover:bg-navy-50 disabled:opacity-60 mb-2 inline-flex items-center justify-center gap-1.5"
          >
            {locating ? (
              "Getting your location..."
            ) : (
              <>
                <MapPin className="w-4 h-4" />
                Use my current location
              </>
            )}
          </button>
          {latitude && (
            <p className="text-xs text-navy bg-navy-50 rounded-md px-3 py-2 mb-2 inline-flex items-center gap-1.5">
              <MapPin className="w-4 h-4" />
              GPS location set ({latitude.toFixed(5)}, {longitude?.toFixed(5)})
            </p>
          )}
          <input
            value={pickupAddress}
            onChange={(e) => setPickupAddress(e.target.value)}
            placeholder="Pickup address description"
            className="w-full border rounded-md px-3 py-2 text-sm"
          />
        </div>

        <div className="pt-2 border-t">
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Opening hours</label>
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                isOpenNowClientSide(status, hours) ? "bg-emerald-100 text-emerald-800" : "bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300"
              }`}
            >
              {isOpenNowClientSide(status, hours) ? "Open now" : "Closed now"}
            </span>
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">
            Customers can't place orders outside these hours. Leave a day unchecked to stay closed all day. No days set at all means always open
            (as long as your shop isn't paused below).
          </p>
          <div className="space-y-1.5">
            {DAY_KEYS.map((day) => {
              const dayHours = hours[day];
              const open = dayHours !== null && dayHours !== undefined;
              return (
                <div key={day} className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 w-28 text-xs text-gray-700 dark:text-gray-300 flex-shrink-0">
                    <input type="checkbox" checked={open} onChange={(e) => toggleDay(day, e.target.checked)} />
                    {DAY_LABELS[day]}
                  </label>
                  {open ? (
                    <>
                      <input
                        type="time"
                        value={dayHours.open}
                        onChange={(e) => setDayTime(day, "open", e.target.value)}
                        className="border rounded-md px-2 py-1 text-xs"
                      />
                      <span className="text-xs text-gray-400 dark:text-gray-500">to</span>
                      <input
                        type="time"
                        value={dayHours.close}
                        onChange={(e) => setDayTime(day, "close", e.target.value)}
                        className="border rounded-md px-2 py-1 text-xs"
                      />
                    </>
                  ) : (
                    <span className="text-xs text-gray-400 dark:text-gray-500">Closed</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="pt-2 border-t">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Prep time</label>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">
            Shown to customers on your storefront as "Usually ready in ~X minutes". Leave blank to not show an estimate.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              value={prepTimeMinutes}
              onChange={(e) => setPrepTimeMinutes(e.target.value)}
              placeholder="e.g. 20"
              className="w-28 border rounded-md px-3 py-2 text-sm"
            />
            <span className="text-sm text-gray-500 dark:text-gray-400">minutes</span>
          </div>
        </div>

        {store && (
          <div className="pt-2 border-t">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Store status</label>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">Pausing hides your shop from customers and blocks new orders, regardless of hours above.</p>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm mt-1">
              <option value="active">Active</option>
              <option value="paused">Paused</option>
            </select>
          </div>
        )}
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
