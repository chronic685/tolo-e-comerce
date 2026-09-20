import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { exportToCsv } from "../lib/csvExport";
import type { OrderRow } from "../types";

const STATUS_LABELS: Record<string, string> = {
  new: "New order",
  accepted: "Order received",
  processing: "Preparing",
  ready_for_pickup: "Ready for pickup",
  picked_up: "Picked up",
  delivered: "Delivered",
  completed: "Completed",
  cancelled: "Cancelled",
  rejected: "Rejected",
};

const UNACK_THRESHOLD_MINUTES = 15;

function isUnacknowledged(mo: OrderRow["merchant_orders"][number]) {
  if (mo.status !== "new" || !mo.notification_sent_at || mo.order_received_at) return false;
  return Date.now() - new Date(mo.notification_sent_at).getTime() > UNACK_THRESHOLD_MINUTES * 60_000;
}

export function Orders() {
  const [searchParams] = useSearchParams();
  const onlyUnacknowledged = searchParams.get("filter") === "unacknowledged";
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("orders")
      .select(
        `id, customer_id, total, payment_status, created_at,
         merchant_orders ( id, merchant_id, status, subtotal, notification_sent_at, order_received_at, escalated_at, merchants ( business_name ) )`,
      )
      .order("created_at", { ascending: false })
      .limit(100)
      .then(({ data }) => {
        setOrders((data as unknown as OrderRow[]) ?? []);
        setLoading(false);
      });
  }, []);

  if (loading) return <p className="text-gray-500">Loading...</p>;

  const visibleOrders = onlyUnacknowledged
    ? orders.filter((o) => o.merchant_orders.some(isUnacknowledged))
    : orders;

  function handleExport() {
    exportToCsv(
      `orders-${new Date().toISOString().slice(0, 10)}.csv`,
      visibleOrders.map((o) => ({
        id: o.id,
        total_etb: o.total,
        payment_status: o.payment_status,
        created_at: o.created_at,
        merchants: o.merchant_orders.map((mo) => mo.merchants?.business_name ?? "Merchant").join(" | "),
        merchant_statuses: o.merchant_orders.map((mo) => STATUS_LABELS[mo.status] ?? mo.status).join(" | "),
        has_unacknowledged: o.merchant_orders.some(isUnacknowledged),
      })),
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">{onlyUnacknowledged ? "Unacknowledged Orders" : "All Orders"}</h1>
        <button
          onClick={handleExport}
          disabled={visibleOrders.length === 0}
          className="text-xs border px-3 py-1.5 rounded-md hover:bg-gray-50 disabled:opacity-40"
        >
          ⬇ Export CSV
        </button>
      </div>
      {visibleOrders.length === 0 ? (
        <p className="text-gray-500">Nothing here.</p>
      ) : (
        <div className="bg-white border rounded-lg divide-y">
          {visibleOrders.map((o) => (
            <div key={o.id} className="p-4">
              <div className="flex justify-between items-center mb-2">
                <div>
                  <p className="font-medium text-sm">Order #{o.id.slice(0, 8)}</p>
                  <p className="text-xs text-gray-500">{new Date(o.created_at).toLocaleString()}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-sm">{o.total.toFixed(2)} ETB</p>
                  <p className="text-xs text-gray-500 capitalize">{o.payment_status}</p>
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                {o.merchant_orders.map((mo) => (
                  <span
                    key={mo.id}
                    className={`text-xs rounded-full px-2 py-0.5 ${
                      mo.escalated_at
                        ? "bg-orange-100 text-orange-900 font-semibold"
                        : isUnacknowledged(mo)
                          ? "bg-red-100 text-red-800 font-semibold"
                          : "bg-gray-100"
                    }`}
                  >
                    {mo.merchants?.business_name ?? "Merchant"}: {STATUS_LABELS[mo.status] ?? mo.status} ({mo.subtotal.toFixed(2)} ETB)
                    {/* escalated_at is the server-side, authoritative signal (Phase 4) — set once by the
                        escalate_unacknowledged_orders() cron job, independent of anyone having this page open.
                        isUnacknowledged() below is a client-side heuristic warning for orders not escalated yet. */}
                    {mo.escalated_at ? " — ESCALATED" : isUnacknowledged(mo) && " — UNACKNOWLEDGED"}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
