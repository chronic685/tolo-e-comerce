import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { exportToCsv } from "../lib/csvExport";
import { ADMIN_PAGE_SIZE, ExportCsvButton, fetchAllRows, formatOrderNumber, Pagination, SkeletonRows, toast, totalPagesFor, usePagination } from "@tolo/ui";
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
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("pending");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const { page, from, to, setPage } = usePagination({ pageSize: ADMIN_PAGE_SIZE, resetKey: filter });

  async function load() {
    setLoading(true);
    let query = supabase
      .from("payments")
      .select("id, order_id, provider, amount, currency, status, created_at, orders ( order_number, customer_id, profiles ( full_name, phone ) )", {
        count: "exact",
      })
      .order("created_at", { ascending: false });
    if (filter !== "all") query = query.eq("status", filter);
    const { data, count } = await query.range(from, to);
    setPayments((data as unknown as Payment[]) ?? []);
    setTotalCount(count ?? 0);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, from, to]);

  async function handleConfirm(payment: Payment) {
    setConfirmingId(payment.id);
    const { error } = await supabase.functions.invoke("confirm-payment", { body: { payment_id: payment.id } });
    setConfirmingId(null);
    if (error) {
      toast.error("Could not confirm this payment. Please try again.");
      return;
    }
    // The status filter is now a real server-side query param, so a
    // confirmed payment can leave the currently-filtered view (e.g. out of
    // "pending") -- reload rather than patch in place.
    await load();
  }

  // Exports every payment matching the current status filter, not just the
  // page on screen.
  async function handleExport() {
    const rows = (await fetchAllRows((from, to) => {
      let query = supabase
        .from("payments")
        .select("id, order_id, provider, amount, currency, status, created_at, orders ( order_number, customer_id, profiles ( full_name, phone ) )")
        .order("created_at", { ascending: false });
      if (filter !== "all") query = query.eq("status", filter);
      return query.range(from, to);
    })) as unknown as Payment[];
    exportToCsv(
      `payments-${new Date().toISOString().slice(0, 10)}.csv`,
      rows.map((p) => ({
        id: p.id,
        order_id: p.order_id,
        order_number: p.orders?.order_number ?? "",
        customer: p.orders?.profiles?.full_name ?? "",
        provider: p.provider,
        amount_etb: String(p.amount),
        status: p.status,
        created_at: p.created_at,
      })),
    );
  }

  if (loading) return <SkeletonRows />;

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">Payments</h1>
        <ExportCsvButton onExport={handleExport} disabled={payments.length === 0} />
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

      {payments.length === 0 ? (
        <p className="text-gray-500 text-sm">No {filter !== "all" ? filter : ""} payments.</p>
      ) : (
        <>
        <div className="bg-white border rounded-lg divide-y">
          {payments.map((p) => (
            <div key={p.id} className="p-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">
                  {p.orders?.profiles?.full_name ?? "Customer"} · {p.provider.replace(/_/g, " ")}
                </p>
                <p className="text-xs text-gray-500">
                  Order {p.orders?.order_number ? formatOrderNumber(p.orders.order_number) : `#${p.order_id.slice(0, 8)}`} · {p.amount.toFixed(2)} {p.currency} · {new Date(p.created_at).toLocaleString()}
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
        <div className="mt-4">
          <Pagination page={page} totalPages={totalPagesFor(totalCount, ADMIN_PAGE_SIZE)} onPageChange={setPage} />
        </div>
        </>
      )}
    </div>
  );
}
