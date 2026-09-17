import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { exportToCsv } from "../lib/csvExport";
import type { FinancialAdjustment, Merchant, Settlement } from "../types";

const ADJUSTMENT_TYPES = ["correction", "bonus", "penalty", "goodwill", "other"];

export function Settlements() {
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [merchantId, setMerchantId] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [adjustments, setAdjustments] = useState<FinancialAdjustment[]>([]);
  const [showAdjustmentForm, setShowAdjustmentForm] = useState(false);
  const [adjMerchantId, setAdjMerchantId] = useState("");
  const [adjType, setAdjType] = useState(ADJUSTMENT_TYPES[0]);
  const [adjAmount, setAdjAmount] = useState("");
  const [adjReason, setAdjReason] = useState("");

  async function load() {
    const { data } = await supabase
      .from("settlements")
      .select("id, merchant_id, period_start, period_end, total_amount, status, created_at, merchants ( business_name )")
      .order("created_at", { ascending: false });
    setSettlements((data as unknown as Settlement[]) ?? []);
  }

  async function loadAdjustments() {
    const { data } = await supabase
      .from("financial_adjustments")
      .select("id, merchant_id, order_id, settlement_id, type, amount, reason, created_at, merchants ( business_name )")
      .order("created_at", { ascending: false })
      .limit(100);
    setAdjustments((data as unknown as FinancialAdjustment[]) ?? []);
  }

  useEffect(() => {
    load();
    loadAdjustments();
    supabase.from("merchants").select("id, business_name").eq("status", "active").then(({ data }) => setMerchants((data as Merchant[]) ?? []));
  }, []);

  async function handleAddAdjustment(e: React.FormEvent) {
    e.preventDefault();
    if (!adjMerchantId || !adjAmount || !adjReason.trim()) return;
    const { error } = await supabase.from("financial_adjustments").insert({
      merchant_id: adjMerchantId,
      type: adjType,
      amount: Number(adjAmount),
      reason: adjReason.trim(),
    });
    if (!error) {
      setAdjMerchantId("");
      setAdjAmount("");
      setAdjReason("");
      setShowAdjustmentForm(false);
      await loadAdjustments();
    }
  }

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

  function handleExport() {
    exportToCsv(
      `settlements-${new Date().toISOString().slice(0, 10)}.csv`,
      settlements.map((s) => ({
        id: s.id,
        merchant: s.merchants?.business_name ?? "",
        period_start: s.period_start,
        period_end: s.period_end,
        total_amount_etb: s.total_amount,
        status: s.status,
        created_at: s.created_at,
      })),
    );
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">Settlements</h1>
        <button
          onClick={handleExport}
          disabled={settlements.length === 0}
          className="text-xs border px-3 py-1.5 rounded-md hover:bg-gray-50 disabled:opacity-40"
        >
          ⬇ Export CSV
        </button>
      </div>

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

      <div className="bg-white border rounded-lg divide-y mb-6">
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

      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Financial Adjustments</h2>
        <button onClick={() => setShowAdjustmentForm((s) => !s)} className="text-xs border px-3 py-1.5 rounded-md hover:bg-gray-50">
          {showAdjustmentForm ? "Cancel" : "+ New adjustment"}
        </button>
      </div>
      <p className="text-xs text-gray-400 mb-2">
        A record of manual corrections — this does not itself change settlement totals; it's the audit trail for why one might be adjusted.
      </p>

      {showAdjustmentForm && (
        <form onSubmit={handleAddAdjustment} className="bg-white border rounded-lg p-4 mb-4 flex gap-2 items-end flex-wrap">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Merchant</label>
            <select value={adjMerchantId} onChange={(e) => setAdjMerchantId(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm">
              <option value="">Select...</option>
              {merchants.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.business_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Type</label>
            <select value={adjType} onChange={(e) => setAdjType(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm capitalize">
              {ADJUSTMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Amount (ETB, can be negative)</label>
            <input
              type="number"
              value={adjAmount}
              onChange={(e) => setAdjAmount(e.target.value)}
              className="w-32 border rounded-md px-2 py-1.5 text-sm"
            />
          </div>
          <input
            placeholder="Reason"
            value={adjReason}
            onChange={(e) => setAdjReason(e.target.value)}
            className="flex-1 min-w-[160px] border rounded-md px-2 py-1.5 text-sm"
          />
          <button type="submit" className="bg-navy text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-navy-dark">
            Add
          </button>
        </form>
      )}

      <div className="bg-white border rounded-lg divide-y">
        {adjustments.length === 0 ? (
          <p className="text-gray-500 text-sm p-4">No adjustments recorded.</p>
        ) : (
          adjustments.map((a) => (
            <div key={a.id} className="flex items-center justify-between p-3">
              <div>
                <p className="text-sm font-medium">
                  {a.merchants?.business_name} · <span className="capitalize">{a.type}</span>
                </p>
                <p className="text-xs text-gray-500">{a.reason}</p>
              </div>
              <div className="text-right">
                <p className={`font-semibold text-sm ${a.amount < 0 ? "text-red-600" : "text-emerald-700"}`}>
                  {a.amount >= 0 ? "+" : ""}
                  {a.amount.toFixed(2)} ETB
                </p>
                <p className="text-xs text-gray-500">{new Date(a.created_at).toLocaleDateString()}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
