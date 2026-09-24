import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { STATUS_COPY } from "../lib/orderStatus";

interface OrderItemRow {
  id: string;
  product_name_snapshot: string;
  variant_attributes_snapshot: Record<string, string>;
  unit_price: number;
  quantity: number;
  subtotal: number;
  product_variants: { product_id: string } | null;
}

interface MerchantOrderRow {
  id: string;
  status: string;
  subtotal: number;
  merchants: { business_name: string; stores: { slug: string } | null } | null;
  order_items: OrderItemRow[];
  order_status_history: { status: string; changed_at: string; note: string | null }[];
}

interface OrderRow {
  id: string;
  subtotal: number;
  total: number;
  delivery_fee: number;
  discount_amount: number;
  payment_status: string;
  created_at: string;
  scheduled_for: string | null;
  addresses: { recipient_name: string; line1: string; city: string; phone: string } | null;
  merchant_orders: MerchantOrderRow[];
  payments: { provider: string }[];
}

const PAYMENT_PENDING_COPY: Record<string, string> = {
  cash_on_delivery: "Pay the delivery agent in cash when your order arrives.",
  bank_transfer: "We'll confirm your bank transfer shortly.",
  mobile_money: "We'll confirm your mobile money payment shortly.",
};

export function OrderDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [order, setOrder] = useState<OrderRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [reviewed, setReviewed] = useState<Set<string>>(new Set());
  const [reportedMerchantOrders, setReportedMerchantOrders] = useState<Set<string>>(new Set());
  const [cancellationEnabled, setCancellationEnabled] = useState(true);
  const [reviewsEnabled, setReviewsEnabled] = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [confirmingCancelId, setConfirmingCancelId] = useState<string | null>(null);

  useEffect(() => {
    load();
    // Same admin-editable toggle FavoritesContext reads (system_settings /
    // customer_features) — the cancel button and the review widget must
    // disappear the moment Tolo turns either off, not just get rejected
    // server-side (reviews_enabled has no server-side enforcement today,
    // same as favorites_enabled — this is UI-only, matching that precedent).
    supabase
      .from("system_settings")
      .select("value")
      .eq("key", "customer_features")
      .maybeSingle()
      .then(({ data }) => {
        const features = data?.value as { order_cancellation_enabled?: boolean; reviews_enabled?: boolean } | null;
        setCancellationEnabled(features?.order_cancellation_enabled ?? true);
        setReviewsEnabled(features?.reviews_enabled ?? true);
      });
  }, [id]);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("orders")
      .select(
        `id, subtotal, total, delivery_fee, discount_amount, payment_status, created_at, scheduled_for,
         addresses ( recipient_name, line1, city, phone ),
         payments ( provider ),
         merchant_orders (
           id, status, subtotal,
           merchants ( business_name, stores ( slug ) ),
           order_items ( id, product_name_snapshot, variant_attributes_snapshot, unit_price, quantity, subtotal, product_variants ( product_id ) ),
           order_status_history ( status, changed_at, note )
         )`,
      )
      .eq("id", id)
      .maybeSingle();
    const o = data as unknown as OrderRow | null;
    setOrder(o);

    const moIds = o?.merchant_orders.map((mo) => mo.id) ?? [];
    if (moIds.length > 0) {
      const { data: reviews } = await supabase
        .from("reviews")
        .select("merchant_order_id, product_id")
        .in("merchant_order_id", moIds);
      setReviewed(new Set((reviews ?? []).map((r) => `${r.merchant_order_id}:${r.product_id}`)));

      const { data: tickets } = await supabase
        .from("support_tickets")
        .select("merchant_order_id")
        .in("merchant_order_id", moIds);
      setReportedMerchantOrders(new Set((tickets ?? []).map((t) => t.merchant_order_id as string)));
    }
    setLoading(false);
  }

  async function reportIssue(merchantOrderId: string, subject: string, body: string) {
    if (!user) return { error: "Not signed in." };
    const { error } = await supabase.from("support_tickets").insert({
      user_id: user.id,
      merchant_order_id: merchantOrderId,
      subject,
      body: body || null,
    });
    if (!error) setReportedMerchantOrders((prev) => new Set(prev).add(merchantOrderId));
    return { error: error?.message };
  }

  async function cancelOrder(merchantOrderId: string) {
    setConfirmingCancelId(null);
    setCancelling(merchantOrderId);
    setCancelError(null);
    const { error } = await supabase.functions.invoke("order-status", {
      body: { merchant_order_id: merchantOrderId, status: "cancelled" },
    });
    if (error) {
      let message = "Could not cancel this order. Please try again.";
      const context = (error as { context?: Response })?.context;
      if (context) {
        try {
          const body = await context.clone().json();
          if (body?.error) message = body.error;
        } catch {
          // Non-JSON error body — fall back to the generic message above.
        }
      }
      setCancelError(message);
      setCancelling(null);
      return;
    }
    setCancelling(null);
    // Was `await load()` -- setLoading(true) inside it wipes the whole page
    // (`if (loading) return <p>Loading order...</p>`) for one merchant
    // order's status changing. The order-status function inserts a status-
    // history row server-side for this exact transition; appending the
    // same thing locally keeps that list complete without re-fetching
    // everything to see it.
    setOrder((prev) =>
      prev
        ? {
            ...prev,
            merchant_orders: prev.merchant_orders.map((mo) =>
              mo.id === merchantOrderId
                ? {
                    ...mo,
                    status: "cancelled",
                    order_status_history: [...mo.order_status_history, { status: "cancelled", changed_at: new Date().toISOString(), note: null }],
                  }
                : mo,
            ),
          }
        : prev,
    );
  }

  async function submitReview(merchantOrderId: string, productId: string, rating: number, comment: string) {
    if (!user) return { error: "Not signed in." };
    const { error } = await supabase.from("reviews").insert({
      merchant_order_id: merchantOrderId,
      product_id: productId,
      customer_id: user.id,
      rating,
      comment: comment || null,
    });
    if (!error) setReviewed((prev) => new Set(prev).add(`${merchantOrderId}:${productId}`));
    return { error: error?.message, code: error?.code };
  }

  if (loading) return <p className="text-gray-500">Loading order...</p>;
  if (!order) return <p className="text-gray-500">Order not found.</p>;

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-bold mb-1">Order #{order.id.slice(0, 8)}</h1>
      <p className="text-sm text-gray-500 mb-1">{new Date(order.created_at).toLocaleString()}</p>
      {order.scheduled_for ? (
        <p className="text-sm font-medium text-navy bg-navy-50 inline-block rounded-md px-2 py-1 mb-5">
          📅 Scheduled for {new Date(order.scheduled_for).toLocaleString()}
        </p>
      ) : (
        <p className="text-sm text-gray-400 mb-5">Delivered as soon as possible</p>
      )}

      {order.addresses && (
        <div className="bg-white border rounded-lg p-4 mb-4 text-sm">
          <p className="font-medium mb-1">Delivering to</p>
          <p>
            {order.addresses.recipient_name} — {order.addresses.phone}
          </p>
          <p>
            {order.addresses.line1}, {order.addresses.city}
          </p>
        </div>
      )}

      {order.merchant_orders.map((mo) => (
        <div key={mo.id} className="bg-white border rounded-lg p-4 mb-4">
          <div className="flex justify-between items-center mb-1">
            {mo.merchants?.stores ? (
              <Link to={`/stores/${mo.merchants.stores.slug}`} className="font-medium hover:text-navy hover:underline">
                {mo.merchants.business_name}
              </Link>
            ) : (
              <p className="font-medium">{mo.merchants?.business_name}</p>
            )}
            <span className="text-xs bg-emerald-100 text-emerald-800 rounded-full px-2 py-0.5">
              {STATUS_COPY[mo.status]?.label ?? mo.status.replace(/_/g, " ")}
            </span>
          </div>
          {STATUS_COPY[mo.status] && <p className="text-xs text-gray-500 mb-2">{STATUS_COPY[mo.status].detail}</p>}
          {mo.status === "new" && cancellationEnabled && (
            <div className="mb-3">
              {confirmingCancelId === mo.id ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-gray-700">Cancel this order?</span>
                  <button
                    onClick={() => cancelOrder(mo.id)}
                    disabled={cancelling === mo.id}
                    className="text-xs bg-red-600 text-white px-3 py-1.5 rounded-md hover:bg-red-700 disabled:opacity-60"
                  >
                    {cancelling === mo.id ? "Cancelling..." : "Yes, cancel"}
                  </button>
                  <button
                    onClick={() => setConfirmingCancelId(null)}
                    disabled={cancelling === mo.id}
                    className="text-xs border px-3 py-1.5 rounded-md hover:bg-gray-50 disabled:opacity-60"
                  >
                    No, keep it
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmingCancelId(mo.id)}
                  className="text-xs border border-red-200 text-red-600 px-3 py-1.5 rounded-md hover:bg-red-50"
                >
                  Cancel order
                </button>
              )}
              {cancelError && <p className="text-red-600 text-xs mt-1">{cancelError}</p>}
            </div>
          )}
          <div className="space-y-1 mb-3">
            {mo.order_items.map((item) => (
              <div key={item.id}>
                <div className="flex justify-between text-sm">
                  <span>
                    {item.product_name_snapshot}
                    {Object.values(item.variant_attributes_snapshot ?? {}).length > 0 &&
                      ` (${Object.values(item.variant_attributes_snapshot).join(" / ")})`}{" "}
                    × {item.quantity}
                  </span>
                  <span>{item.subtotal.toFixed(2)} ETB</span>
                </div>
                {reviewsEnabled && mo.status === "completed" && item.product_variants?.product_id && (
                  <ReviewWidget
                    alreadyReviewed={reviewed.has(`${mo.id}:${item.product_variants.product_id}`)}
                    onSubmit={(rating, comment) => submitReview(mo.id, item.product_variants!.product_id, rating, comment)}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="border-t pt-2">
            <p className="text-xs font-medium text-gray-500 mb-1">Status history</p>
            <ol className="text-xs text-gray-600 space-y-0.5">
              {mo.order_status_history
                .slice()
                .sort((a, b) => new Date(a.changed_at).getTime() - new Date(b.changed_at).getTime())
                .map((h, idx) => (
                  <li key={idx}>
                    {new Date(h.changed_at).toLocaleString()} — {STATUS_COPY[h.status]?.label ?? h.status.replace(/_/g, " ")}
                    {h.note ? ` (${h.note})` : ""}
                  </li>
                ))}
            </ol>
          </div>
          {/* Only once something has actually arrived — "item never arrived"
              and "wrong item" are both post-delivery complaints. Earlier
              statuses (stuck at ready_for_pickup/picked_up) are already
              covered by the platform's own escalation/dispatch monitoring,
              not something a customer needs a dispute ticket for yet; a
              still-unacknowledged or unfulfilled order has "Cancel order"
              instead (status === "new" only). */}
          {(mo.status === "delivered" || mo.status === "completed") && (
            <div className="border-t pt-2 mt-2">
              <DisputeWidget
                alreadyReported={reportedMerchantOrders.has(mo.id)}
                merchantName={mo.merchants?.business_name ?? "this merchant"}
                onSubmit={(subject, body) => reportIssue(mo.id, subject, body)}
              />
            </div>
          )}
        </div>
      ))}

      <div className="bg-white border rounded-lg p-4 space-y-1">
        <div className="flex justify-between text-sm">
          <span>Subtotal</span>
          <span>{order.subtotal.toFixed(2)} ETB</span>
        </div>
        {order.discount_amount > 0 && (
          <div className="flex justify-between text-sm text-emerald-700">
            <span>Discount</span>
            <span>-{order.discount_amount.toFixed(2)} ETB</span>
          </div>
        )}
        {order.delivery_fee > 0 && (
          <div className="flex justify-between text-sm">
            <span>Delivery</span>
            <span>{order.delivery_fee.toFixed(2)} ETB</span>
          </div>
        )}
        <div className="flex justify-between font-semibold pt-1 border-t">
          <span>Total ({order.payment_status})</span>
          <span>{order.total.toFixed(2)} ETB</span>
        </div>
        {order.payment_status === "pending" && order.payments[0] && PAYMENT_PENDING_COPY[order.payments[0].provider] && (
          <p className="text-xs text-gray-500 pt-1">{PAYMENT_PENDING_COPY[order.payments[0].provider]}</p>
        )}
      </div>
    </div>
  );
}

function ReviewWidget({
  alreadyReviewed,
  onSubmit,
}: {
  alreadyReviewed: boolean;
  onSubmit: (rating: number, comment: string) => Promise<{ error?: string; code?: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(alreadyReviewed);
  const [error, setError] = useState<string | null>(null);

  if (done) {
    return <p className="text-xs text-emerald-700 mt-0.5">✓ You reviewed this product</p>;
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs text-navy font-medium mt-0.5">
        Rate this product
      </button>
    );
  }

  async function handleSubmit() {
    if (rating === 0) {
      setError("Please select a star rating.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const { error, code } = await onSubmit(rating, comment);
    setSubmitting(false);
    if (error) {
      // PT429 is this project's convention (see migration 0032) for a
      // database trigger to make PostgREST answer 429 — its message is
      // already a safe, pre-written string, unlike other DB errors.
      setError(code === "PT429" ? error : "Could not submit your review. Please try again.");
      return;
    }
    setDone(true);
  }

  return (
    <div className="mt-1 mb-1 bg-navy-50 rounded-md p-2">
      <div className="flex gap-0.5 mb-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setRating(n)}
            className={`text-lg leading-none ${n <= rating ? "text-orange-500" : "text-gray-300"}`}
            aria-label={`${n} star`}
          >
            ★
          </button>
        ))}
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Optional comment..."
        rows={2}
        className="w-full border rounded-md px-2 py-1 text-xs mb-1"
      />
      {error && <p className="text-red-600 text-xs mb-1">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="bg-navy text-white text-xs px-3 py-1 rounded-md font-medium disabled:opacity-60"
        >
          {submitting ? "Submitting..." : "Submit review"}
        </button>
        <button onClick={() => setOpen(false)} className="text-xs text-gray-500">
          Cancel
        </button>
      </div>
    </div>
  );
}

// Reuses support_tickets' own insert path (same table Support.tsx writes
// to) rather than a parallel dispute system — just with merchant_order_id
// pre-filled, so admin triage sees exactly which order/merchant this is
// about instead of a disconnected blob of text.
function DisputeWidget({
  alreadyReported,
  merchantName,
  onSubmit,
}: {
  alreadyReported: boolean;
  merchantName: string;
  onSubmit: (subject: string, body: string) => Promise<{ error?: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(alreadyReported);
  const [error, setError] = useState<string | null>(null);

  if (done) {
    return <p className="text-xs text-gray-500">You reported an issue with this order — we'll be in touch.</p>;
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs text-red-600 font-medium">
        Report an issue (item never arrived, wrong item, etc.)
      </button>
    );
  }

  async function handleSubmit() {
    if (!body.trim()) {
      setError("Please describe the issue.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const { error } = await onSubmit(`Issue with order from ${merchantName}`, body.trim());
    setSubmitting(false);
    if (error) {
      setError("Could not submit your report. Please try again.");
      return;
    }
    setDone(true);
  }

  return (
    <div className="bg-red-50 rounded-md p-2">
      <p className="text-xs font-medium mb-1">What went wrong?</p>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="e.g. item never arrived, wrong item received..."
        rows={2}
        className="w-full border rounded-md px-2 py-1 text-xs mb-1"
      />
      {error && <p className="text-red-600 text-xs mb-1">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="bg-red-600 text-white text-xs px-3 py-1 rounded-md font-medium disabled:opacity-60"
        >
          {submitting ? "Submitting..." : "Submit report"}
        </button>
        <button onClick={() => setOpen(false)} className="text-xs text-gray-500">
          Cancel
        </button>
      </div>
    </div>
  );
}
