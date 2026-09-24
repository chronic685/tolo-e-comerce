import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { exportToCsv } from "../lib/csvExport";
import type { ReturnRow } from "../types";

const REASONS = ["Customer cancellation", "Merchant unavailable", "Product unavailable", "Delivery failure", "Duplicate payment", "Payment error", "Admin correction", "Other"];

export function Refunds() {
  const [returns, setReturns] = useState<ReturnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refundAmounts, setRefundAmounts] = useState<Record<string, string>>({});
  const [refundReasons, setRefundReasons] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("returns")
      .select(
        `id, merchant_order_id, customer_id, reason, status, created_at,
         merchant_orders ( subtotal, merchants ( business_name ) ),
         profiles ( full_name, phone ),
         refunds ( id, amount, status )`,
      )
      .order("created_at", { ascending: false })
      .limit(100);
    setReturns((data as unknown as ReturnRow[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  // Was `await load()` after each mutation below -- load() sets
  // loading=true, and the WHOLE page (all three sections) is gated behind
  // `if (loading) return <p>Loading...</p>` above, so every single status
  // click flashed the entire Returns & Refunds page. Each is patched into
  // `returns` (and its nested `refunds`, for the refund-status case)
  // directly instead.
  async function setReturnStatus(r: ReturnRow, status: ReturnRow["status"]) {
    const { error } = await supabase.from("returns").update({ status }).eq("id", r.id);
    if (error) return;
    setReturns((prev) => prev.map((row) => (row.id === r.id ? { ...row, status } : row)));
  }

  async function issueRefund(r: ReturnRow) {
    const amount = Number(refundAmounts[r.id] ?? r.merchant_orders?.subtotal ?? 0);
    if (!amount || amount <= 0) return;
    // .select().single() for the server-generated id/status the nested
    // refunds list needs, rather than re-fetching the whole page to find it.
    const { data, error } = await supabase.from("refunds").insert({ return_id: r.id, amount, status: "pending" }).select().single();
    if (error) return;
    setReturns((prev) => prev.map((row) => (row.id === r.id ? { ...row, refunds: [...row.refunds, data] } : row)));
  }

  async function setRefundStatus(refundId: string, status: string) {
    const processed_at = status === "completed" || status === "failed" ? new Date().toISOString() : null;
    const { error } = await supabase.from("refunds").update({ status, processed_at }).eq("id", refundId);
    if (error) return;
    setReturns((prev) =>
      prev.map((row) => ({ ...row, refunds: row.refunds.map((f) => (f.id === refundId ? { ...f, status, processed_at } : f)) })),
    );
  }

  function handleExport() {
    exportToCsv(
      `refunds-${new Date().toISOString().slice(0, 10)}.csv`,
      returns.flatMap((r) =>
        r.refunds.length > 0
          ? r.refunds.map((f) => ({
              return_id: r.id,
              refund_id: f.id,
              customer: r.profiles?.full_name ?? "",
              merchant: r.merchant_orders?.merchants?.business_name ?? "",
              reason: r.reason,
              return_status: r.status,
              refund_amount_etb: String(f.amount),
              refund_status: f.status,
              created_at: r.created_at,
            }))
          : [
              {
                return_id: r.id,
                refund_id: "",
                customer: r.profiles?.full_name ?? "",
                merchant: r.merchant_orders?.merchants?.business_name ?? "",
                reason: r.reason,
                return_status: r.status,
                refund_amount_etb: "",
                refund_status: "",
                created_at: r.created_at,
              },
            ],
      ),
    );
  }

  if (loading) return <p className="text-gray-500">Loading...</p>;

  const requested = returns.filter((r) => r.status === "requested");
  const approvedAwaitingRefund = returns.filter((r) => (r.status === "approved" || r.status === "received") && r.refunds.length === 0);
  const withRefunds = returns.filter((r) => r.refunds.length > 0);

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">Returns &amp; Refunds</h1>
        <button
          onClick={handleExport}
          disabled={returns.length === 0}
          className="text-xs border px-3 py-1.5 rounded-md hover:bg-gray-50 disabled:opacity-40"
        >
          ⬇ Export CSV
        </button>
      </div>

      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Return Requests</h2>
      {requested.length === 0 ? (
        <p className="text-gray-500 text-sm mb-6">No pending return requests.</p>
      ) : (
        <div className="bg-white border rounded-lg divide-y mb-6">
          {requested.map((r) => (
            <div key={r.id} className="p-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{r.profiles?.full_name ?? "Customer"} · {r.merchant_orders?.merchants?.business_name}</p>
                <p className="text-xs text-gray-500">{r.reason} · {r.merchant_orders?.subtotal.toFixed(2)} ETB</p>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button onClick={() => setReturnStatus(r, "approved")} className="text-xs bg-navy text-white px-3 py-1.5 rounded-md hover:bg-navy-dark">
                  Approve
                </button>
                <button onClick={() => setReturnStatus(r, "rejected")} className="text-xs border px-3 py-1.5 rounded-md hover:bg-gray-50">
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Approved — Awaiting Refund (Finance)</h2>
      {approvedAwaitingRefund.length === 0 ? (
        <p className="text-gray-500 text-sm mb-6">Nothing awaiting a refund.</p>
      ) : (
        <div className="bg-white border rounded-lg divide-y mb-6">
          {approvedAwaitingRefund.map((r) => (
            <div key={r.id} className="p-3">
              <div className="flex items-center justify-between gap-3 mb-2">
                <div>
                  <p className="text-sm font-medium">{r.profiles?.full_name ?? "Customer"} · {r.merchant_orders?.merchants?.business_name}</p>
                  <p className="text-xs text-gray-500">{r.reason}</p>
                </div>
                {r.status === "approved" && (
                  <button
                    onClick={() => setReturnStatus(r, "received")}
                    title="Confirm the physical item is back with the merchant — restocks inventory"
                    className="text-xs border px-3 py-1.5 rounded-md hover:bg-gray-50 flex-shrink-0"
                  >
                    Mark item received
                  </button>
                )}
                {r.status === "received" && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 flex-shrink-0">Item received · restocked</span>
                )}
              </div>
              <div className="flex gap-2">
                <select
                  value={refundReasons[r.id] ?? REASONS[0]}
                  onChange={(e) => setRefundReasons({ ...refundReasons, [r.id]: e.target.value })}
                  className="border rounded-md px-2 py-1.5 text-sm"
                >
                  {REASONS.map((reason) => (
                    <option key={reason} value={reason}>
                      {reason}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  placeholder={String(r.merchant_orders?.subtotal ?? 0)}
                  value={refundAmounts[r.id] ?? ""}
                  onChange={(e) => setRefundAmounts({ ...refundAmounts, [r.id]: e.target.value })}
                  className="w-28 border rounded-md px-2 py-1.5 text-sm"
                />
                <button onClick={() => issueRefund(r)} className="text-xs bg-navy text-white px-3 py-1.5 rounded-md hover:bg-navy-dark">
                  Issue refund
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Refunds</h2>
      {withRefunds.length === 0 ? (
        <p className="text-gray-500 text-sm">No refunds issued yet.</p>
      ) : (
        <div className="bg-white border rounded-lg divide-y">
          {withRefunds.map((r) =>
            r.refunds.map((f) => (
              <div key={f.id} className="p-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{r.profiles?.full_name ?? "Customer"} · {r.merchant_orders?.merchants?.business_name}</p>
                  <p className="text-xs text-gray-500">{f.amount.toFixed(2)} ETB · {r.reason}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 capitalize">{f.status}</span>
                  {(f.status === "pending" || f.status === "processing") && (
                    <>
                      <button onClick={() => setRefundStatus(f.id, "completed")} className="text-xs bg-navy text-white px-2 py-1 rounded-md hover:bg-navy-dark">
                        Mark completed
                      </button>
                      <button onClick={() => setRefundStatus(f.id, "failed")} className="text-xs border px-2 py-1 rounded-md hover:bg-gray-50">
                        Mark failed
                      </button>
                    </>
                  )}
                </div>
              </div>
            )),
          )}
        </div>
      )}
    </div>
  );
}
