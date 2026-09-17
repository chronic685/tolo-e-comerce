import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Merchant, Settlement } from "../types";

export function Settlements() {
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [merchantId, setMerchantId] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase
      .from("settlements")
      .select("id, merchant_id, period_start, period_end, total_amount, status, created_at, merchants ( business_name )")
      .order("created_at", { ascending: false });
    setSettlements((data as unknown as Settlement[]) ?? []);
  }

  useEffect(() => {
    load();
    supabase.from("merchants").select("id, business_name").eq("status", "active").then(({ data }) => setMerchants((data as Merchant[]) ?? []));
  }, []);

  async function handleRun(e: React.FormEvent) {
    e.preventDefault();
    if (!merchantId || !periodStart || !periodEnd) return;
    setRunning(true);
    setMessage(null);

    const { data, error } = await supabase.functions.invoke("settlement-run", {
      body: { merchant_id: merchantId, period_start: periodStart, period_end: periodEnd },
    });

    setRunning(false);
    if (error) {
      setMessage(`Error: ${error.message}`);
      return;
    }
    setMessage(data?.message ?? `Settled ${data?.total_amount ?? 0} ETB across ${data?.item_count ?? 0} order(s).`);
    await load();
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-bold mb-4">Settlements</h1>

      <form onSubmit={handleRun} className="bg-white border rounded-lg p-4 mb-4 flex gap-2 items-end flex-wrap">
        <div>
          <label className="text-xs text-gray-500 block mb-1">Merchant</label>
          <select value={merchantId} onChange={(e) => setMerchantId(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm">
            <option value="">Select...</option>
            {merchants.map((m) => (
              <option key={m.id} value={m.id}>
                {m.business_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Period start</label>
          <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Period end</label>
          <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm" />
        </div>
        <button
          type="submit"
          disabled={running}
          className="bg-navy text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-navy-dark disabled:opacity-60"
        >
          {running ? "Running..." : "Run settlement"}
        </button>
      </form>
      {message && <p className="text-sm mb-4">{message}</p>}

      <div className="bg-white border rounded-lg divide-y">
        {settlements.map((s) => (
          <div key={s.id} className="flex items-center justify-between p-3">
            <div>
              <p className="text-sm font-medium">{s.merchants?.business_name}</p>
              <p className="text-xs text-gray-500">
                {s.period_start} → {s.period_end}
              </p>
            </div>
            <div className="text-right">
              <p className="font-semibold text-sm">{s.total_amount.toFixed(2)} ETB</p>
              <p className="text-xs text-gray-500 capitalize">{s.status}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
