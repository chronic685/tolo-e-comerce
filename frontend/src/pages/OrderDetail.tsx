import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Calendar, CheckCircle2, RotateCcw, Star } from "lucide-react";
import {
  Badge,
  Button,
  SkeletonPage,
  Stepper,
  extractServerErrorText,
  formatDateTime,
  formatOrderNumber,
  toast,
  translateServerError,
  useTranslation,
} from "@tolo/ui";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { useCart } from "../lib/CartContext";
import { useStatusCopy } from "../lib/orderStatus";
import { buildTrackSteps, getTrackIndex } from "../lib/orderTrack";
import { canCustomerCancel, deliveryStageFor, pickDeliveryJob, visibleEta, type DeliveryJobView, type DeliveryStage } from "../lib/deliveryStatus";
import { isVariantReorderable, type VariantAvailability } from "../lib/reorder";

interface OrderItemRow {
  id: string;
  product_name_snapshot: string;
  variant_attributes_snapshot: Record<string, string>;
  unit_price: number;
  quantity: number;
  subtotal: number;
  variant_id: string;
  item_status: "active" | "removed" | "substituted";
  resolution_note: string | null;
  product_variants: { product_id: string } | null;
}

interface MerchantOrderRow {
  id: string;
  status: string;
  subtotal: number;
  merchants: { business_name: string; stores: { slug: string } | null } | null;
  order_items: OrderItemRow[];
  order_status_history: { status: string; changed_at: string; note: string | null }[];
  delivery_jobs: DeliveryJobView | DeliveryJobView[] | null;
}

interface OrderRow {
  id: string;
  order_number: number;
  subtotal: number;
  total: number;
  delivery_fee: number;
  discount_amount: number;
  rider_tip: number;
  payment_status: string;
  created_at: string;
  scheduled_for: string | null;
  addresses: { recipient_name: string; line1: string; city: string; phone: string } | null;
  merchant_orders: MerchantOrderRow[];
  payments: { id: string; provider: string; status: string }[];
}

export function OrderDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { addItem } = useCart();
  const { t } = useTranslation();
  const statusCopy = useStatusCopy();
  const PAYMENT_PENDING_COPY: Record<string, string> = {
    cash_on_delivery: t("paymentPending.cashOnDelivery"),
    bank_transfer: t("paymentPending.bankTransfer"),
    mobile_money: t("paymentPending.mobileMoney"),
    chapa: t("paymentPending.chapa"),
    telebirr: t("paymentPending.telebirr"),
  };
  const [order, setOrder] = useState<OrderRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [reviewed, setReviewed] = useState<Set<string>>(new Set());
  const [reportedMerchantOrders, setReportedMerchantOrders] = useState<Set<string>>(new Set());
  const [cancellationEnabled, setCancellationEnabled] = useState(true);
  const [reviewsEnabled, setReviewsEnabled] = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [confirmingCancelId, setConfirmingCancelId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);
  const [paying, setPaying] = useState(false);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // An online gateway payment (Chapa/Telebirr) that was never completed: the
  // first attempt couldn't open, or the customer closed the payment page. The
  // order and its reserved stock already exist, so this asks the backend for
  // a fresh payment page for the same order rather than making them re-order.
  async function payNow(paymentId: string) {
    setPaying(true);
    const { data, error } = await supabase.functions.invoke("payment-initiate", { body: { payment_id: paymentId } });
    if (error || typeof data?.checkout_url !== "string" || !/^https?:\/\//.test(data.checkout_url)) {
      toast.error(t("orders.payNowError"));
      setPaying(false);
      return;
    }
    // Leaves `paying` on: the browser is leaving for the payment page.
    window.location.assign(data.checkout_url);
  }

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("orders")
      .select(
        `id, order_number, subtotal, total, delivery_fee, discount_amount, rider_tip, payment_status, created_at, scheduled_for,
         addresses ( recipient_name, line1, city, phone ),
         payments ( id, provider, status ),
         merchant_orders (
           id, status, subtotal,
           merchants ( business_name, stores ( slug ) ),
           order_items ( id, product_name_snapshot, variant_attributes_snapshot, unit_price, quantity, subtotal, variant_id, item_status, resolution_note, product_variants ( product_id ) ),
           order_status_history ( status, changed_at, note ),
           delivery_jobs ( status, eta_at )
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
      setReportedMerchantOrders(new Set((tickets ?? []).map((ticket) => ticket.merchant_order_id as string)));
    }
    setLoading(false);
  }

  // photo is optional -- uploaded to the private support-ticket-photos
  // bucket under "<merchant_order_id>/..." (migration 0064), which is what
  // lets both the reporting customer and the merchant that order belongs
  // to read it back later, without a public URL.
  async function reportIssue(merchantOrderId: string, subject: string, body: string, photo: File | null) {
    if (!user) return { error: "Not signed in." };

    let photoUrl: string | null = null;
    if (photo) {
      const path = `${merchantOrderId}/${Date.now()}-${photo.name}`;
      const { error: uploadError } = await supabase.storage.from("support-ticket-photos").upload(path, photo);
      if (uploadError) return { error: uploadError.message };
      photoUrl = path;
    }

    const { error } = await supabase.from("support_tickets").insert({
      user_id: user.id,
      merchant_order_id: merchantOrderId,
      subject,
      body: body || null,
      photo_url: photoUrl,
    });
    if (!error) setReportedMerchantOrders((prev) => new Set(prev).add(merchantOrderId));
    return { error: error?.message };
  }

  // Group 4, item 13: adds every item back to the cart at its current
  // price (never the price snapshotted on this old order), skipping
  // anything no longer orderable -- unpublished, or out of stock right
  // now -- and telling the customer exactly what was skipped rather than
  // silently dropping it or failing the whole reorder.
  async function handleReorder() {
    if (!order) return;
    setReordering(true);
    try {
      const allItems = order.merchant_orders.flatMap((mo) => mo.order_items);
      const variantIds = [...new Set(allItems.map((i) => i.variant_id))];
      const { data: variants } = await supabase
        .from("product_variants")
        .select("id, stock_status:variant_stock_status, products ( status )")
        .in("id", variantIds);
      const availability = new Map(
        ((variants as unknown as ({ id: string } & VariantAvailability)[]) ?? []).map((v) => [v.id, v]),
      );

      const skipped: string[] = [];
      let addedCount = 0;
      for (const item of allItems) {
        if (!isVariantReorderable(availability.get(item.variant_id))) {
          skipped.push(item.product_name_snapshot);
          continue;
        }
        await addItem(item.variant_id, item.quantity);
        addedCount++;
      }

      if (skipped.length > 0) {
        toast.error(t("orders.noLongerAvailableSkipped", { items: skipped.join(", ") }));
      }
      if (addedCount > 0) {
        toast.success(t("orders.addedToCart", { count: addedCount }));
        navigate("/cart");
      } else if (skipped.length === 0) {
        toast.error(t("orders.noItemsToReorder"));
      }
    } finally {
      setReordering(false);
    }
  }

  async function cancelOrder(merchantOrderId: string) {
    setConfirmingCancelId(null);
    setCancelling(merchantOrderId);
    const { error } = await supabase.functions.invoke("order-status", {
      body: { merchant_order_id: merchantOrderId, status: "cancelled" },
    });
    if (error) {
      const rawText = await extractServerErrorText(error);
      toast.error(rawText ? translateServerError(rawText, t) : t("orders.cancelGenericError"));
      setCancelling(null);
      return;
    }
    setCancelling(null);
    // Was `await load()` -- setLoading(true) inside it wipes the whole page
    // (`if (loading) return <SkeletonPage />`) for one merchant
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

  if (loading) return <SkeletonPage />;
  if (!order) return <p className="text-gray-500 dark:text-gray-400">{t("orderConfirmation.orderNotFound")}</p>;

  return (
    <div className="max-w-2xl">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h1 className="text-xl font-bold">{t("orders.orderLabel", { orderNumber: formatOrderNumber(order.order_number) })}</h1>
        <button
          onClick={handleReorder}
          disabled={reordering}
          className="flex-shrink-0 inline-flex items-center gap-1.5 text-xs font-medium text-navy border-2 border-navy rounded-md px-3 py-1.5 hover:bg-navy-50 disabled:opacity-60"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          {reordering ? t("orders.reordering") : t("orders.reorder")}
        </button>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">{new Date(order.created_at).toLocaleString()}</p>
      {order.scheduled_for ? (
        <p className="text-sm font-medium text-navy bg-navy-50 inline-flex items-center gap-1.5 rounded-md px-2 py-1 mb-5">
          <Calendar className="w-3.5 h-3.5" />
          {t("orders.scheduledForPrefix", { datetime: new Date(order.scheduled_for).toLocaleString() })}
        </p>
      ) : (
        <p className="text-sm text-gray-400 dark:text-gray-500 mb-5">{t("orders.deliveredAsSoonAsPossible")}</p>
      )}

      {order.addresses && (
        <div className="bg-white dark:bg-navy-dark border rounded-lg p-4 mb-4 text-sm">
          <p className="font-medium mb-1">{t("orders.deliveringTo")}</p>
          <p>
            {order.addresses.recipient_name} — {order.addresses.phone}
          </p>
          <p>
            {order.addresses.line1}, {order.addresses.city}
          </p>
        </div>
      )}

      {order.merchant_orders.map((mo) => {
        const trackIndex = getTrackIndex(mo.status);
        const isTerminal = trackIndex === null;
        return (
        <div key={mo.id} className="bg-white dark:bg-navy-dark border rounded-lg p-4 mb-4">
          <div className="flex justify-between items-center mb-2">
            {mo.merchants?.stores ? (
              <Link to={`/stores/${mo.merchants.stores.slug}`} className="font-medium hover:text-navy hover:underline">
                {mo.merchants.business_name}
              </Link>
            ) : (
              <p className="font-medium">{mo.merchants?.business_name}</p>
            )}
            {isTerminal && (
              <Badge variant="danger">{statusCopy[mo.status]?.label ?? mo.status.replace(/_/g, " ")}</Badge>
            )}
          </div>
          {isTerminal ? (
            statusCopy[mo.status] && <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">{statusCopy[mo.status].detail}</p>
          ) : (
            <div className="mb-3 -mx-1 overflow-x-auto">
              <Stepper
                steps={buildTrackSteps(mo.order_status_history, trackIndex)}
                currentIndex={trackIndex}
                className="min-w-[300px] px-1"
              />
              {statusCopy[mo.status] && (
                <p className="text-xs text-gray-500 dark:text-gray-400 text-center mt-1">{statusCopy[mo.status].detail}</p>
              )}
            </div>
          )}
          {(() => {
            const job = pickDeliveryJob(mo.delivery_jobs);
            const stage = deliveryStageFor(job, mo.status);
            if (!job || !stage) return null;
            const copy: Record<DeliveryStage, { label: string; detail?: string }> = {
              finding: { label: t("orders.delivery.finding") },
              assigned: { label: t("orders.delivery.assigned"), detail: t("orders.delivery.assignedDetail") },
              picked_up: { label: t("orders.delivery.pickedUp"), detail: t("orders.delivery.pickedUpDetail") },
              delivered: { label: t("orders.delivery.delivered") },
              problem: { label: t("orders.delivery.problem") },
            };
            const eta = visibleEta(job);
            return (
              <div className="mb-3 rounded-md bg-gray-50 dark:bg-navy p-3 text-sm" data-testid="delivery-status">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("orders.delivery.title")}</p>
                <p className="font-medium">{copy[stage].label}</p>
                {copy[stage].detail && <p className="text-xs text-gray-500 dark:text-gray-400">{copy[stage].detail}</p>}
                {eta && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t("orders.delivery.eta", { time: formatDateTime(eta) })}</p>}
              </div>
            );
          })()}
          {canCustomerCancel(mo.status, pickDeliveryJob(mo.delivery_jobs)) && cancellationEnabled && (
            <div className="mb-3">
              {confirmingCancelId === mo.id ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-gray-700 dark:text-gray-300">{t("orders.cancelThisOrder")}</span>
                  <span className="basis-full text-xs text-gray-500 dark:text-gray-400">{t("orders.cancelRefundNote")}</span>
                  <button
                    onClick={() => cancelOrder(mo.id)}
                    disabled={cancelling === mo.id}
                    className="text-xs bg-red-600 text-white px-3 py-1.5 rounded-md hover:bg-red-700 disabled:opacity-60"
                  >
                    {cancelling === mo.id ? t("orders.cancelling") : t("orders.yesCancel")}
                  </button>
                  <button
                    onClick={() => setConfirmingCancelId(null)}
                    disabled={cancelling === mo.id}
                    className="text-xs border px-3 py-1.5 rounded-md hover:bg-gray-50 dark:bg-white/5 disabled:opacity-60"
                  >
                    {t("orders.noKeepIt")}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmingCancelId(mo.id)}
                  className="text-xs border border-red-200 text-red-600 px-3 py-1.5 rounded-md hover:bg-red-50"
                >
                  {t("orders.cancelOrder")}
                </button>
              )}
            </div>
          )}
          <div className="space-y-1 mb-3">
            {mo.order_items.map((item) => (
              <div key={item.id}>
                <div className="flex justify-between text-sm">
                  <span className={item.item_status === "removed" ? "line-through text-gray-400 dark:text-gray-500" : ""}>
                    {item.product_name_snapshot}
                    {Object.values(item.variant_attributes_snapshot ?? {}).length > 0 &&
                      ` (${Object.values(item.variant_attributes_snapshot).join(" / ")})`}{" "}
                    × {item.quantity}
                  </span>
                  <span>{item.subtotal.toFixed(2)} ETB</span>
                </div>
                {item.item_status !== "active" && (
                  <p className="text-xs text-amber-700">
                    {item.item_status === "removed" ? t("orders.removedByMerchant") : t("orders.substitutedByMerchant")}
                    {item.resolution_note ? ` — ${item.resolution_note}` : ""}
                  </p>
                )}
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
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("orders.statusHistory")}</p>
            <ol className="text-xs text-gray-600 dark:text-gray-300 space-y-0.5">
              {mo.order_status_history
                .slice()
                .sort((a, b) => new Date(a.changed_at).getTime() - new Date(b.changed_at).getTime())
                .map((h, idx) => (
                  <li key={idx}>
                    {formatDateTime(h.changed_at)} — {statusCopy[h.status]?.label ?? h.status.replace(/_/g, " ")}
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
                merchantName={mo.merchants?.business_name ?? t("orders.thisMerchant")}
                onSubmit={(subject, body, photo) => reportIssue(mo.id, subject, body, photo)}
              />
            </div>
          )}
        </div>
        );
      })}

      <div className="bg-white dark:bg-navy-dark border rounded-lg p-4 space-y-1">
        <div className="flex justify-between text-sm">
          <span>{t("orders.subtotal")}</span>
          <span>{order.subtotal.toFixed(2)} ETB</span>
        </div>
        {order.discount_amount > 0 && (
          <div className="flex justify-between text-sm text-emerald-700">
            <span>{t("orders.discount")}</span>
            <span>-{order.discount_amount.toFixed(2)} ETB</span>
          </div>
        )}
        {order.delivery_fee > 0 && (
          <div className="flex justify-between text-sm">
            <span>{t("orders.delivery")}</span>
            <span>{order.delivery_fee.toFixed(2)} ETB</span>
          </div>
        )}
        <div className="flex justify-between font-semibold pt-1 border-t">
          <span>{t("orders.totalWithStatus", { status: order.payment_status })}</span>
          <span>{order.total.toFixed(2)} ETB</span>
        </div>
        {order.rider_tip > 0 && (
          <div className="flex justify-between text-sm">
            <span>{t("orders.riderTip")}</span>
            <span>{order.rider_tip.toFixed(2)} ETB</span>
          </div>
        )}
        {order.payment_status === "pending" && order.payments[0] && PAYMENT_PENDING_COPY[order.payments[0].provider] && (
          <p className="text-xs text-gray-500 dark:text-gray-400 pt-1">{PAYMENT_PENDING_COPY[order.payments[0].provider]}</p>
        )}
        {order.payment_status !== "paid" &&
          order.payments[0] &&
          (order.payments[0].provider === "chapa" || order.payments[0].provider === "telebirr") &&
          (order.payments[0].status === "pending" || order.payments[0].status === "failed") &&
          !order.merchant_orders.every((mo) => mo.status === "cancelled" || mo.status === "rejected") && (
            <Button type="button" className="w-full mt-2" disabled={paying} onClick={() => payNow(order.payments[0].id)}>
              {paying ? t("orders.payNowOpening") : t("orders.payNow")}
            </Button>
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
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(alreadyReviewed);

  if (done) {
    return (
      <p className="text-xs text-emerald-700 mt-0.5 inline-flex items-center gap-1">
        <CheckCircle2 className="w-3.5 h-3.5" />
        {t("review.alreadyReviewed")}
      </p>
    );
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs text-navy font-medium mt-0.5">
        {t("review.rateProduct")}
      </button>
    );
  }

  async function handleSubmit() {
    if (rating === 0) {
      toast.error(t("review.selectRating"));
      return;
    }
    setSubmitting(true);
    const { error, code } = await onSubmit(rating, comment);
    setSubmitting(false);
    if (error) {
      // PT429 is this project's convention (see migration 0032) for a
      // database trigger to make PostgREST answer 429 — its message is
      // already a safe, pre-written string, unlike other DB errors, but
      // still raw English: translateServerError maps it to the same
      // translated rate-limit string every other 429 in the app uses.
      toast.error(code === "PT429" ? translateServerError(error, t) : t("review.genericError"));
      return;
    }
    setDone(true);
  }

  return (
    <div className="mt-1 mb-1 bg-navy-50 rounded-md p-2">
      <div className="flex gap-0.5 mb-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" onClick={() => setRating(n)} className="leading-none" aria-label={`${n} star`}>
            <Star className={`w-5 h-5 ${n <= rating ? "fill-orange-500 text-orange-500" : "text-gray-300"}`} />
          </button>
        ))}
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder={t("review.optionalComment")}
        rows={2}
        className="w-full border rounded-md px-2 py-1 text-xs mb-1"
      />
      <div className="flex gap-2">
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="bg-navy text-white text-xs px-3 py-1 rounded-md font-medium disabled:opacity-60"
        >
          {submitting ? t("review.submitting") : t("review.submit")}
        </button>
        <button onClick={() => setOpen(false)} className="text-xs text-gray-500 dark:text-gray-400">
          {t("review.cancel")}
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
  onSubmit: (subject: string, body: string, photo: File | null) => Promise<{ error?: string }>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(alreadyReported);

  if (done) {
    return <p className="text-xs text-gray-500 dark:text-gray-400">{t("dispute.alreadyReported")}</p>;
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs text-red-600 font-medium">
        {t("dispute.reportIssueButton")}
      </button>
    );
  }

  async function handleSubmit() {
    if (!body.trim()) {
      toast.error(t("dispute.describeIssue"));
      return;
    }
    setSubmitting(true);
    const { error } = await onSubmit(t("dispute.subjectPrefix", { merchantName }), body.trim(), photo);
    setSubmitting(false);
    if (error) {
      toast.error(t("dispute.genericError"));
      return;
    }
    setDone(true);
  }

  return (
    <div className="bg-red-50 rounded-md p-2">
      <p className="text-xs font-medium mb-1">{t("dispute.whatWentWrong")}</p>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={t("dispute.placeholder")}
        rows={2}
        className="w-full border rounded-md px-2 py-1 text-xs mb-1"
      />
      <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
        {t("dispute.photoOptional")}
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
          className="block w-full text-xs mt-0.5"
        />
      </label>
      <div className="flex gap-2">
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="bg-red-600 text-white text-xs px-3 py-1 rounded-md font-medium disabled:opacity-60"
        >
          {submitting ? t("review.submitting") : t("dispute.submitReport")}
        </button>
        <button onClick={() => setOpen(false)} className="text-xs text-gray-500 dark:text-gray-400">
          {t("review.cancel")}
        </button>
      </div>
    </div>
  );
}
