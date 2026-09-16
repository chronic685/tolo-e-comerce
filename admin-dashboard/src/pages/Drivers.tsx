import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Driver } from "../types";

export function Drivers() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [form, setForm] = useState({ full_name: "", phone: "", vehicle_type: "", vehicle_plate: "" });
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase.from("drivers").select("*").order("full_name");
    setDrivers(data ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!form.full_name.trim() || !form.phone.trim()) return;
    const { error } = await supabase.from("drivers").insert(form);
    if (error) {
      setError(error.message);
      return;
    }
    setForm({ full_name: "", phone: "", vehicle_type: "", vehicle_plate: "" });
    setError(null);
    await load();
  }

  async function toggleActive(d: Driver) {
    await supabase.from("drivers").update({ is_active: !d.is_active }).eq("id", d.id);
    await load();
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-bold mb-4">Drivers</h1>

      <form onSubmit={handleAdd} className="bg-white border rounded-lg p-4 mb-4 flex gap-2 items-end flex-wrap">
        <input
          placeholder="Full name"
          value={form.full_name}
          onChange={(e) => setForm({ ...form, full_name: e.target.value })}
          className="border rounded-md px-2 py-1.5 text-sm"
        />
        <input
          placeholder="Phone"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          className="border rounded-md px-2 py-1.5 text-sm"
        />
        <input
          placeholder="Vehicle type"
          value={form.vehicle_type}
          onChange={(e) => setForm({ ...form, vehicle_type: e.target.value })}
          className="border rounded-md px-2 py-1.5 text-sm"
        />
        <input
          placeholder="Plate number"
          value={form.vehicle_plate}
          onChange={(e) => setForm({ ...form, vehicle_plate: e.target.value })}
          className="border rounded-md px-2 py-1.5 text-sm"
        />
        <button type="submit" className="bg-slate-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-slate-800">
          Add driver
        </button>
      </form>
      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      <div className="bg-white border rounded-lg divide-y">
        {drivers.map((d) => (
          <div key={d.id} className="flex items-center justify-between p-3">
            <div>
              <p className="text-sm font-medium">{d.full_name}</p>
              <p className="text-xs text-gray-500">
                {d.phone} · {[d.vehicle_type, d.vehicle_plate].filter(Boolean).join(" · ") || "—"}
              </p>
            </div>
            <button
              onClick={() => toggleActive(d)}
              className={`text-xs px-2 py-1 rounded-full border ${
                d.is_active ? "bg-emerald-100 text-emerald-800 border-emerald-200" : "bg-gray-100 text-gray-600"
              }`}
            >
              {d.is_active ? "Active" : "Inactive"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
