import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, formatOrderNumber, useTranslation } from "@tolo/ui";
import { supabase } from "../lib/supabase";

interface QueueOrder {
  id: string;
  status: string;
  created_at: string;
  order_number: number | null;
}

// Every non-terminal status a merchant still needs to act on or track --
// same active set Orders.tsx's own filters treat as "in flight".
const ACTIVE_STATUSES = ["new", "accepted", "processing", "ready_for_pickup"];

const STATUS_VARIANT: Record<string, "warning" | "navy" | "info" | "success"> = {
  new: "warning",
  accepted: "navy",
  processing: "navy",
  ready_for_pickup: "info",
};

/** Item 6: a live-updating list of every order still in flight, on the
 * dashboard itself -- not just the full-screen "new order" alert
 * (NewOrderAlert.tsx), which only ever shows brand-new orders one at a
 * time. Reuses the same reconnect-safety shape as NewOrderAlert: an initial
 * fetch catches anything already active when the tab opens/reconnects, and
 * a realtime subscription (both INSERT and UPDATE, so an order leaving the
 * active set drops out of the list live) keeps it current after that. */
export function LiveOrderQueue({ merchantId }: { merchantId: string }) {
  const { t } = useTranslation();
  const [orders, setOrders] = useState<QueueOrder[] | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("merchant_orders")
      .select("id, status, created_at, orders ( order_number )")
      .eq("merchant_id", merchantId)
      .in("status", ACTIVE_STATUSES)
      .order("created_at", { ascending: true });
    const rows = (data ?? []) as unknown as { id: string; status: string; created_at: string; orders: { order_number: number } | { order_number: number }[] | null }[];
    setOrders(
      rows.map((row) => ({
        id: row.id,
        status: row.status,
        created_at: row.created_at,
        order_number: (Array.isArray(row.orders) ? row.orders[0]?.order_number : row.orders?.order_number) ?? null,
      })),
    );
  }, [merchantId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel(`merchant-live-queue-${merchantId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "merchant_orders", filter: `merchant_id=eq.${merchantId}` }, () => load())
      .subscribe((status) => {
        // Reconnect-safety: if the socket drops and comes back (network
        // blip, laptop sleep), Supabase resubscribes the channel but any
        // change that happened while disconnected was never delivered as an
        // event -- re-fetch once on every fresh SUBSCRIBED to catch up.
        if (status === "SUBSCRIBED") load();
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [merchantId, load]);

  if (orders === null) return null;

  return (
    <div className="bg-white dark:bg-navy-dark border dark:border-white/10 rounded-lg p-4 mt-6">
      <h2 className="font-semibold dark:text-gray-100 mb-3">{t("merchantDashboard.liveQueue")}</h2>
      {orders.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500">{t("merchantDashboard.noLiveOrders")}</p>
      ) : (
        <ul className="divide-y dark:divide-white/10">
          {orders.map((order) => (
            <li key={order.id}>
              <Link
                to={`/orders/${order.id}`}
                className="flex items-center justify-between gap-2 py-2 text-sm hover:bg-gray-50 dark:hover:bg-white/5 -mx-1 px-1 rounded"
              >
                <span className="dark:text-gray-200">{order.order_number ? formatOrderNumber(order.order_number) : `#${order.id.slice(0, 8)}`}</span>
                <Badge variant={STATUS_VARIANT[order.status] ?? "default"}>{order.status.replaceAll("_", " ")}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
