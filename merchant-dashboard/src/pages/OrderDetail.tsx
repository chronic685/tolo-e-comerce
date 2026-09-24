import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";

interface OrderItemRow {
  id: string;
  product_name_snapshot: string;
  variant_attributes_snapshot: Record<string, string>;
  unit_price: number;
  quantity: number;
  subtotal: number;
}

interface MerchantOrderDetail {
  id: string;
  status: string;
  subtotal: number;
  commission_amount: number;
  merchant_payable: number;
  scheduled_for: string | null;
  order_items: OrderItemRow[];
  orders: {
    addresses: { recipient_name: string; phone: string; line1: string; city: string } | null;
    payments: { id: string; provider: string; status: string }[];
  } | null;
  order_status_history: { status: string; changed_at: string; note: string | null }[];
}

const TRANSITIONS: Record<string, { status: string; label: string; primary?: boolean }[]> = {
  new: [
    { status: "accepted", label: "ORDER RECEIVED", primary: true },
    { status: "rejected", label: "Reject order" },
  ],
  accepted: [
    { status: "processing", label: "Start preparing", primary: true },
    { status: "cancelled", label: "Cancel order" },
  ],
  processing: [
    { status: "ready_for_pickup", label: "Ready for pickup", primary: true },
    { status: "cancelled", label: "Cancel order" },
  ],
};

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

export function OrderDetail() {
  const { id } = useParams();
  const [order, setOrder] = useState<MerchantOrderDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase
      .from("merchant_orders")
      .select(
        `id, status, subtotal, commission_amount, merchant_payable, scheduled_for,
         order_items ( id, product_name_snapshot, variant_attributes_snapshot, unit_price, quantity, subtotal ),
         orders ( addresses ( recipient_name, phone, line1, city ), payments ( id, provider, status ) ),
         order_status_history ( status, changed_at, note )`,
      )
      .eq("id", id)
      .maybeSingle();
    setOrder(data as unknown as MerchantOrderDetail | null);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Both handlers below were `await load()` -- a full re-fetch of every
  // joined table on this page for a change we already know the outcome of.
  // handleTransition also appends a status-history entry locally: the
  // order-status function inserts one server-side, and the confirmed
  // transition (this exact status, right now) is the same thing it would
  // have written, so the "Status history" list stays complete without
  // waiting on a re-fetch to see it.
  async function handleTransition(status: string) {
    setBusy(true);
    setError(null);
    const { error } = await supabase.functions.invoke("order-status", {
      body: { merchant_order_id: id, status },
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setOrder((prev) =>
      prev
        ? { ...prev, status, order_status_history: [...prev.order_status_history, { status, changed_at: new Date().toISOString(), note: null }] }
        : prev,
    );
  }

  async function handleConfirmCash(paymentId: string) {
    setBusy(true);
    setError(null);
    const { error } = await supabase.functions.invoke("confirm-payment", {
      body: { payment_id: paymentId },
    });
    setBusy(false);
    if (error) {
      setError("Could not confirm this payment. Please try again.");
      return;
    }
    setOrder((prev) =>
      prev && prev.orders
        ? { ...prev, orders: { ...prev.orders, payments: prev.orders.payments.map((p) => (p.id === paymentId ? { ...p, status: "verified" } : p)) } }
        : prev,
    );
  }

  if (!order) return <p className="text-gray-500">Loading...</p>;

  const actions = TRANSITIONS[order.status] ?? [];

  return (
    <div className="max-w-xl">
      <h1 className={`text-xl font-bold ${order.scheduled_for ? "mb-1" : "mb-4"}`}>Order #{order.id.slice(0, 8)}</h1>
      {order.scheduled_for && (
        <p className="text-sm font-medium text-navy bg-navy-50 inline-block rounded-md px-2 py-1 mb-4">
          📅 Scheduled for {new Date(order.scheduled_for).toLocaleString()} — no rush, this doesn't need to be prepared yet
        </p>
      )}

      {order.orders?.addresses && (
        <div className="bg-white border rounded-lg p-4 mb-4 text-sm">
          <p className="font-medium mb-1">Deliver to</p>
          <p>
            {order.orders.addresses.recipient_name} — {order.orders.addresses.phone}
          </p>
          <p>
            {order.orders.addresses.line1}, {order.orders.addresses.city}
          </p>
        </div>
      )}

      <div className="bg-white border rounded-lg p-4 mb-4">
        <p className="font-medium text-sm mb-2">Items</p>
        {order.order_items.map((item) => (
          <div key={item.id} className="flex justify-between text-sm mb-1">
            <span>
              {item.product_name_snapshot}
              {Object.values(item.variant_attributes_snapshot ?? {}).length > 0 &&
                ` (${Object.values(item.variant_attributes_snapshot).join(" / ")})`}{" "}
              × {item.quantity}
            </span>
            <span>{item.subtotal.toFixed(2)} ETB</span>
          </div>
        ))}
        <div className="border-t mt-2 pt-2 text-sm space-y-1">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>{order.subtotal.toFixed(2)} ETB</span>
          </div>
          <div className="flex justify-between text-gray-500">
            <span>Platform commission</span>
            <span>-{order.commission_amount.toFixed(2)} ETB</span>
          </div>
          <div className="flex justify-between font-semibold">
            <span>You receive</span>
            <span>{order.merchant_payable.toFixed(2)} ETB</span>
          </div>
        </div>
      </div>

      {order.orders?.payments[0] && (
        <div className="bg-white border rounded-lg p-4 mb-4 flex items-center justify-between text-sm">
          <div>
            <p className="font-medium">Payment: {order.orders.payments[0].provider.replace(/_/g, " ")}</p>
            <p className="text-xs text-gray-500 capitalize">{order.orders.payments[0].status}</p>
          </div>
          {order.orders.payments[0].provider === "cash_on_delivery" && order.orders.payments[0].status === "pending" && (
            <button
              onClick={() => handleConfirmCash(order.orders!.payments[0].id)}
              disabled={busy}
              className="bg-navy text-white px-3 py-1.5 rounded-md text-xs font-medium hover:bg-navy-dark disabled:opacity-60"
            >
              Confirm cash received
            </button>
          )}
        </div>
      )}

      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      {actions.length > 0 && (
        <div className="flex gap-2 mb-4">
          {actions.map((a) => (
            <button
              key={a.status}
              onClick={() => handleTransition(a.status)}
              disabled={busy}
              className={`px-4 py-2 rounded-md text-sm font-medium disabled:opacity-60 ${
                a.primary ? "bg-navy text-white hover:bg-navy-dark" : "border hover:bg-gray-50"
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}

      <div className="bg-white border rounded-lg p-4">
        <p className="text-xs font-medium text-gray-500 mb-2">Status history</p>
        <ol className="text-xs text-gray-600 space-y-1">
          {order.order_status_history
            .slice()
            .sort((a, b) => new Date(a.changed_at).getTime() - new Date(b.changed_at).getTime())
            .map((h, idx) => (
              <li key={idx}>
                {new Date(h.changed_at).toLocaleString()} — {STATUS_LABELS[h.status] ?? h.status.replace(/_/g, " ")}
                {h.note ? ` (${h.note})` : ""}
              </li>
            ))}
        </ol>
      </div>
    </div>
  );
}
