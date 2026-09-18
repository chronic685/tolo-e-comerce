import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { getCurrentLocation } from "../lib/geolocation";
import type { Address } from "../types";

const EMPTY_FORM = {
  label: "Home",
  recipient_name: "",
  phone: "",
  line1: "",
  city: "",
  sub_city: "",
  landmark: "",
  latitude: null as number | null,
  longitude: null as number | null,
};

export function SavedLocations() {
  const { user } = useAuth();
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) load();
  }, [user]);

  async function load() {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from("addresses")
      .select("*")
      .eq("customer_id", user.id)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: false });
    setAddresses(data ?? []);
    setLoading(false);
  }

  async function handleUseCurrentLocation() {
    setLocating(true);
    setError(null);
    try {
      const loc = await getCurrentLocation();
      setForm((f) => ({
        ...f,
        latitude: loc.latitude,
        longitude: loc.longitude,
        line1: loc.line1 || f.line1,
        city: loc.city || f.city,
        sub_city: loc.subCity || f.sub_city,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not get your location.");
    } finally {
      setLocating(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setError(null);
    const { error } = await supabase
      .from("addresses")
      .insert({ customer_id: user.id, ...form, country: "ET", is_default: addresses.length === 0 });
    if (error) {
      setError("Could not save this location. Please try again.");
      return;
    }
    setForm(EMPTY_FORM);
    setShowForm(false);
    load();
  }

  async function handleSetDefault(id: string) {
    if (!user) return;
    setAddresses((prev) => prev.map((a) => ({ ...a, is_default: a.id === id })));
    await supabase.from("addresses").update({ is_default: false }).eq("customer_id", user.id);
    await supabase.from("addresses").update({ is_default: true }).eq("id", id);
  }

  async function handleDelete(id: string) {
    setError(null);
    const { error } = await supabase.from("addresses").delete().eq("id", id);
    if (error) {
      setError("This location is used by a past order and can't be deleted.");
      return;
    }
    setAddresses((prev) => prev.filter((a) => a.id !== id));
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-xl font-bold mb-4">Saved locations</h1>

      {loading ? (
        <p className="text-gray-500 text-sm">Loading...</p>
      ) : addresses.length === 0 && !showForm ? (
        <p className="text-gray-500 text-sm mb-4">You haven't saved a delivery location yet.</p>
      ) : (
        <div className="space-y-2 mb-4">
          {addresses.map((a) => (
            <div key={a.id} className="bg-white border rounded-lg p-3 text-sm">
              <div className="flex justify-between items-start gap-2">
                <div>
                  <p className="font-medium">
                    {a.label ?? "Address"}
                    {a.is_default && <span className="ml-2 text-xs bg-navy-50 text-navy rounded-full px-2 py-0.5">Default</span>}
                  </p>
                  <p className="text-gray-600 mt-0.5">
                    {a.recipient_name}, {a.phone}
                  </p>
                  <p className="text-gray-500">
                    📍 {a.line1}, {a.city}
                    {a.latitude && <span className="text-xs text-gray-400"> (GPS confirmed)</span>}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {!a.is_default && (
                    <button onClick={() => handleSetDefault(a.id)} className="text-xs text-navy font-medium">
                      Set default
                    </button>
                  )}
                  <button onClick={() => handleDelete(a.id)} className="text-xs text-red-600 font-medium">
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      {!showForm ? (
        <button onClick={() => setShowForm(true)} className="text-navy text-sm font-medium">
          + Add new location
        </button>
      ) : (
        <form onSubmit={handleSave} className="bg-white border rounded-lg p-4 space-y-2">
          <button
            type="button"
            onClick={handleUseCurrentLocation}
            disabled={locating}
            className="w-full border-2 border-navy text-navy rounded-md px-3 py-2 text-sm font-medium hover:bg-navy-50 disabled:opacity-60"
          >
            {locating ? "Getting your location..." : "📍 Use my current location"}
          </button>
          {form.latitude && (
            <p className="text-xs text-navy bg-navy-50 rounded-md px-3 py-2">📍 Location confirmed — you can still edit the details below.</p>
          )}
          <select
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            className="w-full border rounded-md px-3 py-2 text-sm"
          >
            <option>Home</option>
            <option>Work</option>
            <option>Other</option>
          </select>
          <input
            placeholder="Recipient name"
            value={form.recipient_name}
            onChange={(e) => setForm({ ...form, recipient_name: e.target.value })}
            required
            className="w-full border rounded-md px-3 py-2 text-sm"
          />
          <input
            placeholder="Phone"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            required
            className="w-full border rounded-md px-3 py-2 text-sm"
          />
          <input
            placeholder="Street / area"
            value={form.line1}
            onChange={(e) => setForm({ ...form, line1: e.target.value })}
            required
            className="w-full border rounded-md px-3 py-2 text-sm"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              placeholder="City"
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
              required
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
            <input
              placeholder="Sub-city (optional)"
              value={form.sub_city}
              onChange={(e) => setForm({ ...form, sub_city: e.target.value })}
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
          </div>
          <input
            placeholder="Landmark (optional)"
            value={form.landmark}
            onChange={(e) => setForm({ ...form, landmark: e.target.value })}
            className="w-full border rounded-md px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button type="submit" className="bg-navy text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-navy-dark">
              Save location
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setForm(EMPTY_FORM);
              }}
              className="text-sm text-gray-500"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
