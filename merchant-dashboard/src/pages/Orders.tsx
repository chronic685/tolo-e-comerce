import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useMerchant } from "../lib/MerchantContext";
import type { MerchantOrder } from "../types";

const statusColors: Record<string, string> = {
  new: "bg-yellow-100 text-yellow-800",
  accepted: "bg-blue-100 text-blue-800",
  rejected: "bg-red-100 text-red-800",
  processing: "bg-blue-100 text-blue-800",
  ready_for_pickup: "bg-purple-100 text-purple-800",
  picked_up: "bg-purple-100 text-purple-800",
  delivered: "bg-emerald-100 text-emerald-800",
  completed: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-red-100 text-red-800",
};

const FILTERS = ["all", "new", "accepted", "processing", "ready_for_pickup", "completed"];

export function Orders() {
  const { merchant } = useMerchant();
  const [orders, setOrders] = useState<MerchantOrder[]>([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!merchant) return;
    setLoading(true);
    let query = supabase
      .from("merchant_orders")
      .select("id, order_id, merchant_id, status, subtotal, commission_amount, merchant_payable, created_at, order_items ( id, product_name_snapshot, quantity )")
      .eq("merchant_id", merchant.id)
      .order("created_at", { ascending: false });

    if (filter !== "all") query = query.eq("status", filter);

    query.then(({ data }) => {
      setOrders((data as unknown as MerchantOrder[]) ?? []);
      setLoading(false);
    });
  }, [merchant, filter]);

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">Orders</h1>
      <div className="flex gap-2 mb-4 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-xs border capitalize ${
              filter === f ? "bg-gray-900 text-white border-gray-900" : "bg-white"
            }`}
          >
            {f.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : orders.length === 0 ? (
        <p className="text-gray-500">No orders in this view.</p>
      ) : (
        <div className="bg-white border rounded-lg divide-y">
          {orders.map((o) => (
            <Link key={o.id} to={`/orders/${o.id}`} className="flex items-center justify-between p-4 hover:bg-gray-50">
              <div>
                <p className="font-medium text-sm">Order #{o.id.slice(0, 8)}</p>
                <p className="text-xs text-gray-500">{o.order_items.length} item(s) · {new Date(o.created_at).toLocaleDateString()}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-semibold text-sm">{o.subtotal.toFixed(2)} ETB</span>
                <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${statusColors[o.status]}`}>
                  {o.status.replace(/_/g, " ")}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
