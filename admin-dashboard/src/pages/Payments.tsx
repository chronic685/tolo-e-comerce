import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { exportToCsv } from "../lib/csvExport";
import type { Payment } from "../types";

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  verified: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
  refunded: "bg-gray-100 text-gray-700",
};

// No automated gateway is connected for any of these (see
// supabase/functions/_shared/payment_providers.ts) — every one of them is
// confirmed by a human, not a webhook. Cash is confirmed by the merchant
// (they physically collect it); bank/mobile-money need Tolo finance to
// reconcile against the real bank/telco statement, since the merchant has
// no way to verify a transfer into Tolo's own account.
const FINANCE_CONFIRMABLE = new Set(["bank_transfer", "mobile_money"]);

export function Payments() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("pending");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("payments")
      .select("id, order_id, provider, amount, currency, status, created_at, orders ( customer_id, profiles ( full_name, phone ) )")
      .order("created_at", { ascending: false })
      .limit(200);
    setPayments((data as unknown as Payment[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleConfirm(payment: Payment) {
    setConfirmingId(payment.id);
    setError(null);
    const { error } = await supabase.functions.invoke("confirm-payment", { body: { payment_id: payment.id } });
    setConfirmingId(null);
    if (error) {
      setError("Could not confirm this payment. Please try again.");
      return;
    }
    // Was `load()` -- setLoading(true) inside it wipes the whole list to
    // "Loading..." for one payment's status changing. `filter` is applied
    // client-side at render time (not a server query param), so patching
    // status here re-filters correctly on the next render with no extra
    // fetch needed.
    setPayments((prev) => prev.map((p) => (p.id === payment.id ? { ...p, status: "verified" } : p)));
  }

  function handleExport() {
    exportToCsv(
      `payments-${new Date().toISOString().slice(0, 10)}.csv`,
      payments.map((p) => ({
        id: p.id,
        order_id: p.order_id,
        customer: p.orders?.profiles?.full_name ?? "",
        provider: p.provider,
        amount_etb: String(p.amount),
        status: p.status,
        created_at: p.created_at,
      })),
    );
  }

  const filtered = filter === "all" ? payments : payments.filter((p) => p.status === filter);

  if (loading) return <p className="text-gray-500">Loading...</p>;

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">Payments</h1>
        <button onClick={handleExport} disabled={payments.length === 0} className="text-xs border px-3 py-1.5 rounded-md hover:bg-gray-50 disabled:opacity-40">
          ⬇ Export CSV
        </button>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {["pending", "verified", "failed", "refunded", "all"].map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-full text-sm border capitalize ${filter === s ? "bg-navy text-white border-navy" : "bg-white"}`}
          >
            {s}
          </button>
        ))}
      </div>

      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      {filtered.length === 0 ? (
        <p className="text-gray-500 text-sm">No {filter !== "all" ? filter : ""} payments.</p>
      ) : (
        <div className="bg-white border rounded-lg divide-y">
          {filtered.map((p) => (
            <div key={p.id} className="p-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">
                  {p.orders?.profiles?.full_name ?? "Customer"} · {p.provider.replace(/_/g, " ")}
                </p>
                <p className="text-xs text-gray-500">
                  Order #{p.order_id.slice(0, 8)} · {p.amount.toFixed(2)} {p.currency} · {new Date(p.created_at).toLocaleString()}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLE[p.status] ?? "bg-gray-100 text-gray-700"}`}>{p.status}</span>
                {p.status === "pending" && FINANCE_CONFIRMABLE.has(p.provider) && (
                  <button
                    onClick={() => handleConfirm(p)}
                    disabled={confirmingId === p.id}
                    className="text-xs bg-navy text-white px-3 py-1.5 rounded-md hover:bg-navy-dark disabled:opacity-60"
                  >
                    {confirmingId === p.id ? "Confirming..." : "Confirm received"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
