import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Calendar } from "lucide-react";
import { extractServerErrorText, formatOrderNumber, SkeletonPage, toast, translateServerError, useTranslation } from "@tolo/ui";
import { supabase } from "../lib/supabase";
import { useMerchant } from "../lib/MerchantContext";

interface OrderItemRow {
  id: string;
  variant_id: string;
  product_name_snapshot: string;
  variant_attributes_snapshot: Record<string, string>;
  unit_price: number;
  quantity: number;
  subtotal: number;
  on_unavailable: "remove" | "substitute" | "cancel_order";
  item_status: "active" | "removed" | "substituted";
  resolution_note: string | null;
}

interface SubstituteOption {
  variant_id: string;
  product_name: string;
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
    order_number: number;
    addresses: { recipient_name: string; phone: string; line1: string; city: string } | null;
    payments: { id: string; provider: string; status: string }[];
  } | null;
  order_status_history: { status: string; changed_at: string; note: string | null }[];
}

export function OrderDetail() {
  const { id } = useParams();
  const { merchant } = useMerchant();
  const { t } = useTranslation();
  const [order, setOrder] = useState<MerchantOrderDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [resolvingItemId, setResolvingItemId] = useState<string | null>(null);
  const [substituteOptions, setSubstituteOptions] = useState<SubstituteOption[]>([]);
  const [chosenSubstitute, setChosenSubstitute] = useState("");

  const UNAVAILABLE_PREFERENCE_LABELS: Record<string, string> = {
    remove: t("substitution.customerAskedRemove"),
    substitute: t("substitution.customerAskedSubstitute"),
    cancel_order: t("substitution.customerAskedCancel"),
  };

  const TRANSITIONS: Record<string, { status: string; label: string; primary?: boolean }[]> = {
    new: [
      { status: "accepted", label: t("merchant.orderReceived"), primary: true },
      { status: "rejected", label: t("merchant.rejectOrder") },
    ],
    accepted: [
      { status: "processing", label: t("merchant.startPreparing"), primary: true },
      { status: "cancelled", label: t("orders.cancelOrder") },
    ],
    processing: [
      { status: "ready_for_pickup", label: t("orderStatus.ready_for_pickup"), primary: true },
      { status: "cancelled", label: t("orders.cancelOrder") },
    ],
  };

  async function load() {
    const { data } = await supabase
      .from("merchant_orders")
      .select(
        `id, status, subtotal, commission_amount, merchant_payable, scheduled_for,
         order_items ( id, variant_id, product_name_snapshot, variant_attributes_snapshot, unit_price, quantity, subtotal, on_unavailable, item_status, resolution_note ),
         orders ( order_number, addresses ( recipient_name, phone, line1, city ), payments ( id, provider, status ) ),
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

  async function openResolvePanel(item: OrderItemRow) {
    setResolvingItemId(item.id);
    setChosenSubstitute("");
    if (item.on_unavailable === "substitute" && merchant) {
      const { data } = await supabase
        .from("product_variants")
        .select("id, products!inner ( name, merchant_id, status )")
        .eq("products.merchant_id", merchant.id)
        .eq("products.status", "published")
        .neq("id", item.variant_id);
      const options = ((data as unknown as { id: string; products: { name: string } }[]) ?? []).map((v) => ({
        variant_id: v.id,
        product_name: v.products.name,
      }));
      setSubstituteOptions(options);
    }
  }

  async function handleResolveItem(item: OrderItemRow, action: "remove" | "substitute") {
    if (action === "substitute" && !chosenSubstitute) {
      toast.error(t("merchant.chooseReplacementProduct"));
      return;
    }
    setBusy(true);
    const { error } = await supabase.functions.invoke("resolve-order-item", {
      body: { order_item_id: item.id, action, substitute_variant_id: action === "substitute" ? chosenSubstitute : undefined },
    });
    setBusy(false);
    if (error) {
      toast.error(translateServerError(await extractServerErrorText(error), t));
      return;
    }
    toast.success(action === "remove" ? t("merchant.itemRemovedToast") : t("merchant.substituteAppliedToast"));
    setResolvingItemId(null);
    await load();
  }

  // Both handlers below were `await load()` -- a full re-fetch of every
  // joined table on this page for a change we already know the outcome of.
  // handleTransition also appends a status-history entry locally: the
  // order-status function inserts one server-side, and the confirmed
  // transition (this exact status, right now) is the same thing it would
  // have written, so the "Status history" list stays complete without
  // waiting on a re-fetch to see it.
  async function handleTransition(status: string) {
    setBusy(true);
    const { error } = await supabase.functions.invoke("order-status", {
      body: { merchant_order_id: id, status },
    });
    setBusy(false);
    if (error) {
      toast.error(translateServerError(await extractServerErrorText(error), t));
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
    const { error } = await supabase.functions.invoke("confirm-payment", {
      body: { payment_id: paymentId },
    });
    setBusy(false);
    if (error) {
      toast.error(t("merchant.confirmCashFailed"));
      return;
    }
    setOrder((prev) =>
      prev && prev.orders
        ? { ...prev, orders: { ...prev.orders, payments: prev.orders.payments.map((p) => (p.id === paymentId ? { ...p, status: "verified" } : p)) } }
        : prev,
    );
  }

  if (!order) return <SkeletonPage />;

  const actions = TRANSITIONS[order.status] ?? [];

  return (
    <div className="max-w-xl">
      <h1 className={`text-xl font-bold ${order.scheduled_for ? "mb-1" : "mb-4"}`}>
        {t("orders.orderLabel", {
          orderNumber: order.orders?.order_number ? formatOrderNumber(order.orders.order_number) : `#${order.id.slice(0, 8)}`,
        })}
      </h1>
      {order.scheduled_for && (
        <p className="text-sm font-medium text-navy bg-navy-50 inline-flex items-center gap-1.5 rounded-md px-2 py-1 mb-4">
          <Calendar className="w-4 h-4" />
          {t("merchant.scheduledForNoRush", { datetime: new Date(order.scheduled_for).toLocaleString() })}
        </p>
      )}

      {order.orders?.addresses && (
        <div className="bg-white dark:bg-navy-dark border rounded-lg p-4 mb-4 text-sm">
          <p className="font-medium mb-1">{t("merchant.deliverTo")}</p>
          <p>
            {order.orders.addresses.recipient_name} — {order.orders.addresses.phone}
          </p>
          <p>
            {order.orders.addresses.line1}, {order.orders.addresses.city}
          </p>
        </div>
      )}

      <div className="bg-white dark:bg-navy-dark border rounded-lg p-4 mb-4">
        <p className="font-medium text-sm mb-2">{t("merchant.itemsHeading")}</p>
        {order.order_items.map((item) => {
          const canResolve = item.item_status === "active" && ["new", "accepted", "processing"].includes(order.status);
          return (
            <div key={item.id} className="mb-2">
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
                <p className="text-xs text-amber-700 mt-0.5">
                  {item.item_status === "removed" ? t("merchant.removed") : t("merchant.substituted")}
                  {item.resolution_note ? ` — ${item.resolution_note}` : ""}
                </p>
              )}
              {canResolve && resolvingItemId !== item.id && (
                <button onClick={() => openResolvePanel(item)} className="text-xs text-red-600 hover:underline mt-0.5">
                  {t("substitution.cantFulfill")}
                </button>
              )}
              {resolvingItemId === item.id && (
                <div className="bg-gray-50 dark:bg-white/5 border rounded-md p-3 mt-1 text-xs space-y-2">
                  <p className="text-gray-600 dark:text-gray-300">{UNAVAILABLE_PREFERENCE_LABELS[item.on_unavailable]}</p>
                  {item.on_unavailable === "remove" && (
                    <button
                      onClick={() => handleResolveItem(item, "remove")}
                      disabled={busy}
                      className="bg-navy text-white px-3 py-1.5 rounded-md font-medium disabled:opacity-60"
                    >
                      {t("substitution.confirmRemoved")}
                    </button>
                  )}
                  {item.on_unavailable === "substitute" && (
                    <div className="flex items-center gap-2">
                      <select
                        value={chosenSubstitute}
                        onChange={(e) => setChosenSubstitute(e.target.value)}
                        className="border rounded-md px-2 py-1 flex-1"
                      >
                        <option value="">{t("substitution.chooseReplacement")}</option>
                        {substituteOptions.map((opt) => (
                          <option key={opt.variant_id} value={opt.variant_id}>
                            {opt.product_name}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => handleResolveItem(item, "substitute")}
                        disabled={busy}
                        className="bg-navy text-white px-3 py-1.5 rounded-md font-medium disabled:opacity-60"
                      >
                        {t("substitution.applySubstitute")}
                      </button>
                    </div>
                  )}
                  {item.on_unavailable === "cancel_order" && (
                    <button
                      onClick={() => handleTransition("rejected")}
                      disabled={busy}
                      className="bg-red-600 text-white px-3 py-1.5 rounded-md font-medium disabled:opacity-60"
                    >
                      {t("substitution.cancelOrderRefund")}
                    </button>
                  )}
                  <button onClick={() => setResolvingItemId(null)} className="text-gray-500 dark:text-gray-400 hover:underline block">
                    {t("common.cancel")}
                  </button>
                </div>
              )}
            </div>
          );
        })}
        <div className="border-t mt-2 pt-2 text-sm space-y-1">
          <div className="flex justify-between">
            <span>{t("orders.subtotal")}</span>
            <span>{order.subtotal.toFixed(2)} ETB</span>
          </div>
          <div className="flex justify-between text-gray-500 dark:text-gray-400">
            <span>{t("merchant.platformCommission")}</span>
            <span>-{order.commission_amount.toFixed(2)} ETB</span>
          </div>
          <div className="flex justify-between font-semibold">
            <span>{t("merchant.youReceive")}</span>
            <span>{order.merchant_payable.toFixed(2)} ETB</span>
          </div>
        </div>
      </div>

      {order.orders?.payments[0] && (
        <div className="bg-white dark:bg-navy-dark border rounded-lg p-4 mb-4 flex items-center justify-between text-sm">
          <div>
            <p className="font-medium">{t("merchant.paymentLabel", { provider: order.orders.payments[0].provider.replace(/_/g, " ") })}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">{order.orders.payments[0].status}</p>
          </div>
          {order.orders.payments[0].provider === "cash_on_delivery" && order.orders.payments[0].status === "pending" && (
            <button
              onClick={() => handleConfirmCash(order.orders!.payments[0].id)}
              disabled={busy}
              className="bg-navy text-white px-3 py-1.5 rounded-md text-xs font-medium hover:bg-navy-dark disabled:opacity-60"
            >
              {t("merchant.confirmCashReceived")}
            </button>
          )}
        </div>
      )}

      {actions.length > 0 && (
        <div className="flex gap-2 mb-4">
          {actions.map((a) => (
            <button
              key={a.status}
              onClick={() => handleTransition(a.status)}
              disabled={busy}
              className={`px-4 py-2 rounded-md text-sm font-medium disabled:opacity-60 ${
                a.primary ? "bg-navy text-white hover:bg-navy-dark" : "border hover:bg-gray-50 dark:bg-white/5"
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}

      <div className="bg-white dark:bg-navy-dark border rounded-lg p-4">
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">{t("orders.statusHistory")}</p>
        <ol className="text-xs text-gray-600 dark:text-gray-300 space-y-1">
          {order.order_status_history
            .slice()
            .sort((a, b) => new Date(a.changed_at).getTime() - new Date(b.changed_at).getTime())
            .map((h, idx) => (
              <li key={idx}>
                {new Date(h.changed_at).toLocaleString()} — {t(`orderStatus.${h.status}`)}
                {h.note ? ` (${h.note})` : ""}
              </li>
            ))}
        </ol>
      </div>
    </div>
  );
}
