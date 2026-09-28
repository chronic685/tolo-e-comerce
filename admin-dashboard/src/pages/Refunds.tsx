import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { exportToCsv } from "../lib/csvExport";
import { ADMIN_PAGE_SIZE, ExportCsvButton, fetchAllRows, Pagination, SkeletonRows, totalPagesFor, usePagination } from "@tolo/ui";
import type { RefundRow, ReturnRow } from "../types";

const REASONS = ["Customer cancellation", "Merchant unavailable", "Product unavailable", "Delivery failure", "Duplicate payment", "Payment error", "Admin correction", "Other"];

const RETURN_SELECT = `id, merchant_order_id, customer_id, reason, status, created_at,
         merchant_orders ( subtotal, merchants ( business_name ) ),
         profiles ( full_name, phone ),
         refunds ( id, amount, status )`;

export function Refunds() {
  // Three genuinely separate operational queues, each its own query/page --
  // deriving them all by client-side .filter() on one .limit(100) fetch (as
  // this page used to) can't produce a correct .range()-paginated count for
  // any of them individually.
  const [requested, setRequested] = useState<ReturnRow[]>([]);
  const [requestedTotal, setRequestedTotal] = useState(0);
  const requestedPage = usePagination({ pageSize: ADMIN_PAGE_SIZE, paramName: "requested_page" });

  const [approvedAwaitingRefund, setApprovedAwaitingRefund] = useState<ReturnRow[]>([]);
  const [approvedAwaitingRefundTotal, setApprovedAwaitingRefundTotal] = useState(0);
  const awaitingRefundPage = usePagination({ pageSize: ADMIN_PAGE_SIZE, paramName: "awaiting_refund_page" });

  const [refunds, setRefunds] = useState<RefundRow[]>([]);
  const [refundsTotal, setRefundsTotal] = useState(0);
  const refundsPage = usePagination({ pageSize: ADMIN_PAGE_SIZE, paramName: "refunds_page" });

  const [loading, setLoading] = useState(true);
  const [refundAmounts, setRefundAmounts] = useState<Record<string, string>>({});
  const [refundReasons, setRefundReasons] = useState<Record<string, string>>({});

  async function loadRequested() {
    const { data, count } = await supabase
      .from("returns")
      .select(RETURN_SELECT, { count: "exact" })
      .eq("status", "requested")
      .order("created_at", { ascending: false })
      .range(requestedPage.from, requestedPage.to);
    setRequested((data as unknown as ReturnRow[]) ?? []);
    setRequestedTotal(count ?? 0);
  }

  // PR #6 review fix: this used to be an unpaginated `.limit(200)` fetch
  // with the refunds.length === 0 half of "awaiting refund" applied
  // client-side -- past 200 matching rows, older ones could silently fall
  // off. returns_awaiting_refund() (migration 0055) expresses the whole
  // condition (approved/received AND no refund row yet) as a real,
  // filterable/countable computed column, so this is now a normal
  // exact-counted, .range()-paginated query. Refunds must never be
  // silently hidden.
  async function loadApprovedAwaitingRefund() {
    const { data, count } = await supabase
      .from("returns")
      .select(RETURN_SELECT, { count: "exact" })
      .eq("returns_awaiting_refund", true)
      .order("created_at", { ascending: false })
      .range(awaitingRefundPage.from, awaitingRefundPage.to);
    setApprovedAwaitingRefund((data as unknown as ReturnRow[]) ?? []);
    setApprovedAwaitingRefundTotal(count ?? 0);
  }

  // Queried directly from `refunds` (rather than derived from `returns`
  // client-side) -- every row here is a refund that actually exists, so
  // this is a real, correctly .range()-paginated list.
  async function loadRefunds() {
    const { data, count } = await supabase
      .from("refunds")
      .select(
        `id, amount, status, processed_at, return_id,
         returns ( id, reason, created_at, merchant_orders ( subtotal, merchants ( business_name ) ), profiles ( full_name, phone ) )`,
        { count: "exact" },
      )
      .order("processed_at", { ascending: false, nullsFirst: true })
      .range(refundsPage.from, refundsPage.to);
    setRefunds((data as unknown as RefundRow[]) ?? []);
    setRefundsTotal(count ?? 0);
  }

  useEffect(() => {
    setLoading(true);
    Promise.all([loadRequested(), loadApprovedAwaitingRefund(), loadRefunds()]).then(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch just the affected queue on a page change -- these re-run once
  // more on mount alongside the effect above (harmless, just one extra
  // request each) since both are keyed independently.
  useEffect(() => {
    loadRequested();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedPage.from, requestedPage.to]);

  useEffect(() => {
    loadRefunds();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refundsPage.from, refundsPage.to]);

  useEffect(() => {
    loadApprovedAwaitingRefund();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaitingRefundPage.from, awaitingRefundPage.to]);

  // A status change can move a row between queues (requested -> awaiting
  // refund; awaiting refund -> has a refund), so each mutation just
  // reloads the queues it could have affected, rather than hand-patching
  // three independently-paginated arrays in place.
  async function setReturnStatus(r: ReturnRow, status: ReturnRow["status"]) {
    const { error } = await supabase.from("returns").update({ status }).eq("id", r.id);
    if (error) return;
    await Promise.all([loadRequested(), loadApprovedAwaitingRefund()]);
  }

  async function issueRefund(r: ReturnRow) {
    const amount = Number(refundAmounts[r.id] ?? r.merchant_orders?.subtotal ?? 0);
    if (!amount || amount <= 0) return;
    const { error } = await supabase.from("refunds").insert({ return_id: r.id, amount, status: "pending" });
    if (error) return;
    await loadApprovedAwaitingRefund();
    // Newest-first ordering means the new refund always belongs on page 1.
    if (refundsPage.page === 1) await loadRefunds();
    else refundsPage.setPage(1);
  }

  async function setRefundStatus(refundId: string, status: string) {
    const processed_at = status === "completed" || status === "failed" ? new Date().toISOString() : null;
    const { error } = await supabase.from("refunds").update({ status, processed_at }).eq("id", refundId);
    if (error) return;
    setRefunds((prev) => prev.map((f) => (f.id === refundId ? { ...f, status, processed_at } : f)));
  }

  // Exports every refund, not just the page on screen -- fetched in
  // Supabase's own max_rows-sized pages (see fetchAllRows) so a large
  // export is never silently truncated.
  async function handleExport() {
    const rows = (await fetchAllRows((from, to) =>
      supabase
        .from("refunds")
        .select(
          `id, amount, status, processed_at, return_id,
           returns ( id, reason, created_at, merchant_orders ( subtotal, merchants ( business_name ) ), profiles ( full_name, phone ) )`,
        )
        .order("processed_at", { ascending: false, nullsFirst: true })
        .range(from, to),
    )) as unknown as RefundRow[];
    exportToCsv(
      `refunds-${new Date().toISOString().slice(0, 10)}.csv`,
      rows.map((f) => ({
        return_id: f.return_id,
        refund_id: f.id,
        customer: f.returns?.profiles?.full_name ?? "",
        merchant: f.returns?.merchant_orders?.merchants?.business_name ?? "",
        reason: f.returns?.reason ?? "",
        refund_amount_etb: String(f.amount),
        refund_status: f.status,
        created_at: f.returns?.created_at ?? "",
      })),
    );
  }

  if (loading) return <SkeletonRows />;

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">Returns &amp; Refunds</h1>
        <ExportCsvButton onExport={handleExport} disabled={refunds.length === 0} />
      </div>

      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Return Requests</h2>
      {requested.length === 0 ? (
        <p className="text-gray-500 text-sm mb-6">No pending return requests.</p>
      ) : (
        <>
        <div className="bg-white border rounded-lg divide-y mb-2">
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
        <div className="mb-6">
          <Pagination page={requestedPage.page} totalPages={totalPagesFor(requestedTotal, ADMIN_PAGE_SIZE)} onPageChange={requestedPage.setPage} />
        </div>
        </>
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
      <div className="mb-6">
        <Pagination
          page={awaitingRefundPage.page}
          totalPages={totalPagesFor(approvedAwaitingRefundTotal, ADMIN_PAGE_SIZE)}
          onPageChange={awaitingRefundPage.setPage}
        />
      </div>

      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Refunds</h2>
      {refunds.length === 0 ? (
        <p className="text-gray-500 text-sm">No refunds issued yet.</p>
      ) : (
        <>
          <div className="bg-white border rounded-lg divide-y">
            {refunds.map((f) => (
              <div key={f.id} className="p-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">
                    {f.returns?.profiles?.full_name ?? "Customer"} · {f.returns?.merchant_orders?.merchants?.business_name}
                  </p>
                  <p className="text-xs text-gray-500">{f.amount.toFixed(2)} ETB · {f.returns?.reason}</p>
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
            ))}
          </div>
          <div className="mt-4">
            <Pagination page={refundsPage.page} totalPages={totalPagesFor(refundsTotal, ADMIN_PAGE_SIZE)} onPageChange={refundsPage.setPage} />
          </div>
        </>
      )}
    </div>
  );
}
