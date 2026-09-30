import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, formatCurrency, formatOrderNumber, formatRelativeTime, useTranslation } from "@tolo/ui";
import { supabase } from "../lib/supabase";

interface FeedOrder {
  id: string;
  order_number: number | null;
  total: number;
  created_at: string;
}

const FEED_SIZE = 8;

/** Item 3's "live order queue" for the admin dashboard: the newest paid
 * orders platform-wide, updating live as they come in via Supabase
 * realtime -- the admin equivalent of merchant-dashboard's per-merchant
 * LiveOrderQueue. Same reconnect-safety shape: an initial fetch, then a
 * subscription that re-fetches on every fresh SUBSCRIBED (not just once at
 * mount), so a dropped/restored connection can't silently miss orders. */
export function LiveOrdersFeed() {
  const { t } = useTranslation();
  const [orders, setOrders] = useState<FeedOrder[] | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("orders")
      .select("id, order_number, total, created_at")
      .order("created_at", { ascending: false })
      .limit(FEED_SIZE);
    setOrders((data ?? []) as FeedOrder[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel("admin-live-orders-feed")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "orders" }, () => load())
      .subscribe((status) => {
        if (status === "SUBSCRIBED") load();
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  if (orders === null) return null;

  return (
    <div className="bg-white dark:bg-navy-dark border dark:border-white/10 rounded-lg p-4 mb-6">
      <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">{t("merchantDashboard.liveQueue")}</h2>
      {orders.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500">{t("merchantDashboard.noLiveOrders")}</p>
      ) : (
        <ul className="divide-y dark:divide-white/10">
          {orders.map((order) => (
            <li key={order.id}>
              <Link
                to={`/orders?order=${order.id}`}
                className="flex items-center justify-between gap-2 py-2 text-sm hover:bg-gray-50 dark:hover:bg-white/5 -mx-1 px-1 rounded"
              >
                <span className="dark:text-gray-200">{order.order_number ? formatOrderNumber(order.order_number) : `#${order.id.slice(0, 8)}`}</span>
                <span className="flex items-center gap-2 flex-shrink-0">
                  <Badge variant="navy-subtle">{formatCurrency(order.total)}</Badge>
                  <span className="text-xs text-gray-400 dark:text-gray-500">{formatRelativeTime(order.created_at)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
