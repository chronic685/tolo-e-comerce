import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Delivery, Driver } from "../types";

const STATUS_FLOW: Record<string, string[]> = {
  pending: ["assigned"],
  assigned: ["picked_up", "failed"],
  picked_up: ["in_transit"],
  in_transit: ["delivered", "failed"],
};

export function Deliveries() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("deliveries")
      .select(
        `id, merchant_order_id, driver_id, status, pickup_address, pickup_contact_name, pickup_contact_phone,
         dropoff_address, dropoff_contact_name, dropoff_contact_phone, created_at,
         drivers ( full_name ),
         merchant_orders ( merchants ( business_name ) )`,
      )
      .order("created_at", { ascending: false });
    setDeliveries((data as unknown as Delivery[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    supabase.from("drivers").select("*").eq("is_active", true).then(({ data }) => setDrivers(data ?? []));
  }, []);

  // Was `await load()` after every mutation — load() sets loading=true
  // first, which unmounts the entire list behind a bare "Loading..." (see
  // the `if (loading) return ...` below), flashing the whole page for what
  // should be a one-row update. Patching the affected row into state
  // directly avoids both the network round-trip and the flash; the
  // optimistic patch only applies once the call is confirmed to have
  // succeeded, so a failed request leaves the row exactly as it was rather
  // than lying about the outcome.
  async function assignDriver(delivery: Delivery, driverId: string) {
    setBusyId(delivery.id);
    const { error } = await supabase.functions.invoke("delivery-dispatch", {
      body: { delivery_id: delivery.id, status: "assigned", driver_id: driverId },
    });
    setBusyId(null);
    if (error) return;
    const driver = drivers.find((d) => d.id === driverId);
    setDeliveries((prev) =>
      prev.map((d) => (d.id === delivery.id ? { ...d, status: "assigned", driver_id: driverId, drivers: driver ? { full_name: driver.full_name } : d.drivers } : d)),
    );
  }

  async function advanceStatus(delivery: Delivery, status: string) {
    setBusyId(delivery.id);
    const { error } = await supabase.functions.invoke("delivery-dispatch", { body: { delivery_id: delivery.id, status } });
    setBusyId(null);
    if (error) return;
    setDeliveries((prev) => prev.map((d) => (d.id === delivery.id ? { ...d, status } : d)));
  }

  if (loading) return <p className="text-gray-500">Loading...</p>;

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">Deliveries</h1>
      {deliveries.length === 0 ? (
        <p className="text-gray-500">No deliveries yet.</p>
      ) : (
        <div className="bg-white border rounded-lg divide-y">
          {deliveries.map((d) => (
            <div key={d.id} className="p-4">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <p className="font-medium text-sm">{d.merchant_orders?.merchants?.business_name}</p>
                  <p className="text-xs text-gray-500">{new Date(d.created_at).toLocaleString()}</p>
                </div>
                <span className="text-xs bg-gray-100 rounded-full px-2 py-0.5 capitalize">{d.status.replace(/_/g, " ")}</span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs mb-3">
                <div>
                  <p className="font-medium text-gray-500">Pickup</p>
                  <p>{d.pickup_contact_name} · {d.pickup_contact_phone}</p>
                  <p className="text-gray-500">{d.pickup_address ?? "No pickup address on file"}</p>
                </div>
                <div>
                  <p className="font-medium text-gray-500">Drop-off</p>
                  <p>{d.dropoff_contact_name} · {d.dropoff_contact_phone}</p>
                  <p className="text-gray-500">{d.dropoff_address ?? "No drop-off address on file"}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {d.status === "pending" && (
                  <select
                    onChange={(e) => e.target.value && assignDriver(d, e.target.value)}
                    disabled={busyId === d.id}
                    defaultValue=""
                    className="text-xs border rounded-md px-2 py-1.5"
                  >
                    <option value="" disabled>
                      Assign driver...
                    </option>
                    {drivers.map((driver) => (
                      <option key={driver.id} value={driver.id}>
                        {driver.full_name}
                      </option>
                    ))}
                  </select>
                )}
                {d.driver_id && <span className="text-xs text-gray-500">Driver: {d.drivers?.full_name}</span>}
                {(STATUS_FLOW[d.status] ?? []).map((next) => (
                  <button
                    key={next}
                    onClick={() => advanceStatus(d, next)}
                    disabled={busyId === d.id}
                    className="text-xs border px-2 py-1 rounded-md hover:bg-gray-50 capitalize disabled:opacity-60"
                  >
                    Mark {next.replace(/_/g, " ")}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
