import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { OrderRow } from "../types";

export function Orders() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("orders")
      .select(
        `id, customer_id, total, payment_status, created_at,
         merchant_orders ( id, merchant_id, status, subtotal, merchants ( business_name ) )`,
      )
      .order("created_at", { ascending: false })
      .limit(100)
      .then(({ data }) => {
        setOrders((data as unknown as OrderRow[]) ?? []);
        setLoading(false);
      });
  }, []);

  if (loading) return <p className="text-gray-500">Loading...</p>;

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">All Orders</h1>
      <div className="bg-white border rounded-lg divide-y">
        {orders.map((o) => (
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
                <span key={mo.id} className="text-xs bg-gray-100 rounded-full px-2 py-0.5">
                  {mo.merchants?.business_name ?? "Merchant"}: {mo.status.replace(/_/g, " ")} ({mo.subtotal.toFixed(2)} ETB)
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
