import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { DeliveryZone } from "../types";

const emptyForm = {
  name: "",
  description: "",
  center_latitude: "",
  center_longitude: "",
  radius_km: "5",
  delivery_fee: "50",
  free_delivery_threshold: "",
  max_distance_km: "",
  estimated_delivery_minutes: "45",
};

export function DeliveryZones() {
  const [zones, setZones] = useState<DeliveryZone[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    const { data } = await supabase.from("delivery_zones").select("*").order("created_at", { ascending: false });
    setZones((data as DeliveryZone[]) ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function toggleActive(z: DeliveryZone) {
    const { error } = await supabase.from("delivery_zones").update({ is_active: !z.is_active }).eq("id", z.id);
    if (error) return;
    setZones((prev) => prev.map((zone) => (zone.id === z.id ? { ...zone, is_active: !zone.is_active } : zone)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.name.trim() || !form.center_latitude || !form.center_longitude) {
      setError("Name and center coordinates are required.");
      return;
    }
    setSaving(true);
    const { data, error } = await supabase
      .from("delivery_zones")
      .insert({
        name: form.name.trim(),
        description: form.description.trim() || null,
        center_latitude: Number(form.center_latitude),
        center_longitude: Number(form.center_longitude),
        radius_km: Number(form.radius_km),
        delivery_fee: Number(form.delivery_fee),
        free_delivery_threshold: form.free_delivery_threshold ? Number(form.free_delivery_threshold) : null,
        max_distance_km: form.max_distance_km ? Number(form.max_distance_km) : null,
        estimated_delivery_minutes: form.estimated_delivery_minutes ? Number(form.estimated_delivery_minutes) : null,
      })
      .select()
      .single();
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setZones((prev) => [data as DeliveryZone, ...prev]);
    setForm(emptyForm);
    setShowForm(false);
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-bold mb-1">Delivery Zones</h1>
      <p className="text-sm text-gray-500 mb-4">
        Each zone is a coverage circle (center point + radius). A delivery is priced by the nearest zone whose radius contains the
        drop-off point; orders outside every zone use the flat fee from Settings → Delivery.
      </p>

      <button onClick={() => setShowForm((s) => !s)} className="bg-navy text-white text-sm px-4 py-2 rounded-md hover:bg-navy-dark mb-4">
        {showForm ? "Cancel" : "+ New zone"}
      </button>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white border rounded-lg p-4 mb-4 space-y-3">
          <input
            placeholder="Zone name (e.g. Bole)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full border rounded-md px-3 py-2 text-sm"
          />
          <input
            placeholder="Description (optional)"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full border rounded-md px-3 py-2 text-sm"
          />
          <div className="grid grid-cols-3 gap-2">
            <input
              type="number"
              step="0.000001"
              placeholder="Center latitude"
              value={form.center_latitude}
              onChange={(e) => setForm({ ...form, center_latitude: e.target.value })}
              className="border rounded-md px-2 py-1.5 text-sm"
            />
            <input
              type="number"
              step="0.000001"
              placeholder="Center longitude"
              value={form.center_longitude}
              onChange={(e) => setForm({ ...form, center_longitude: e.target.value })}
              className="border rounded-md px-2 py-1.5 text-sm"
            />
            <input
              type="number"
              placeholder="Radius (km)"
              value={form.radius_km}
              onChange={(e) => setForm({ ...form, radius_km: e.target.value })}
              className="border rounded-md px-2 py-1.5 text-sm"
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Delivery fee (ETB)</label>
              <input
                type="number"
                value={form.delivery_fee}
                onChange={(e) => setForm({ ...form, delivery_fee: e.target.value })}
                className="w-full border rounded-md px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Free above (ETB, optional)</label>
              <input
                type="number"
                value={form.free_delivery_threshold}
                onChange={(e) => setForm({ ...form, free_delivery_threshold: e.target.value })}
                className="w-full border rounded-md px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Est. delivery (minutes)</label>
              <input
                type="number"
                value={form.estimated_delivery_minutes}
                onChange={(e) => setForm({ ...form, estimated_delivery_minutes: e.target.value })}
                className="w-full border rounded-md px-2 py-1.5 text-sm"
              />
            </div>
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={saving}
            className="bg-navy text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-navy-dark disabled:opacity-60"
          >
            {saving ? "Creating..." : "Create zone"}
          </button>
        </form>
      )}

      <div className="bg-white border rounded-lg divide-y">
        {zones.length === 0 ? (
          <p className="text-gray-500 text-sm p-4">No delivery zones configured — all orders use the flat platform fee.</p>
        ) : (
          zones.map((z) => (
            <div key={z.id} className="p-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{z.name}</p>
                <p className="text-xs text-gray-500">
                  {z.radius_km} km radius · {z.delivery_fee.toFixed(2)} ETB
                  {z.free_delivery_threshold ? ` · free above ${z.free_delivery_threshold} ETB` : ""}
                  {z.estimated_delivery_minutes ? ` · ~${z.estimated_delivery_minutes} min` : ""}
                </p>
              </div>
              <button
                onClick={() => toggleActive(z)}
                className={`text-xs px-2 py-1 rounded-full border flex-shrink-0 ${
                  z.is_active ? "bg-emerald-100 text-emerald-800 border-emerald-200" : "bg-gray-100 text-gray-600"
                }`}
              >
                {z.is_active ? "Active" : "Inactive"}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
