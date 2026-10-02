import { useState } from "react";
import { formatOrderNumber, useTranslation } from "@tolo/ui";
import { useNewOrderQueue } from "../lib/NewOrderQueueContext";

/** Full-screen modal for the newest order in the queue (NewOrderQueueContext
 * owns the actual fetch/realtime/sound logic now, shared with the header
 * badge -- see Layout.tsx). */
export function NewOrderAlert() {
  const { t } = useTranslation();
  const { queue, acknowledge } = useNewOrderQueue();
  const [acknowledging, setAcknowledging] = useState(false);
  const current = queue[0];

  async function handleReceived() {
    if (!current) return;
    setAcknowledging(true);
    await acknowledge(current.id);
    setAcknowledging(false);
  }

  if (!current) return null;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-navy-dark rounded-lg max-w-sm w-full p-6 shadow-2xl border-2 border-red-500">
        <p className="text-xs font-bold text-red-600 tracking-wide mb-1">{t("newOrderAlert.newOrder")}</p>
        <h2 className="text-xl font-bold mb-1 dark:text-gray-100">
          {t("orders.orderLabel", {
            orderNumber: current.orders?.order_number ? formatOrderNumber(current.orders.order_number) : `#${current.id.slice(0, 8)}`,
          })}
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">{new Date(current.created_at).toLocaleTimeString()}</p>

        <div className="space-y-1 mb-4 border-t border-b dark:border-white/10 py-3">
          {current.items.map((item, idx) => (
            <div key={idx} className="flex justify-between text-sm dark:text-gray-200">
              <span>
                {item.product_name_snapshot}
                {Object.values(item.variant_attributes_snapshot ?? {}).length > 0 &&
                  ` (${Object.values(item.variant_attributes_snapshot).join(" / ")})`}{" "}
                × {item.quantity}
              </span>
            </div>
          ))}
        </div>

        <div className="flex justify-between font-semibold mb-5 dark:text-gray-100">
          <span>{t("newOrderAlert.youllReceive")}</span>
          <span>{current.merchant_payable.toFixed(2)} ETB</span>
        </div>

        <button
          onClick={handleReceived}
          disabled={acknowledging}
          className="w-full bg-navy dark:bg-navy-light text-white py-3 rounded-md font-bold text-lg hover:bg-navy-dark dark:hover:bg-navy disabled:opacity-60"
        >
          {acknowledging ? "..." : t("merchant.orderReceived")}
        </button>
        {queue.length > 1 && (
          <p className="text-xs text-gray-400 dark:text-gray-500 text-center mt-2">
            {t("newOrderAlert.moreNewOrders", { count: queue.length - 1 })}
          </p>
        )}
      </div>
    </div>
  );
}
