import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { STATUS_COPY } from "../lib/orderStatus";

interface OrderRow {
  id: string;
  total: number;
  payment_status: string;
  created_at: string;
  merchant_orders: { id: string; status: string; merchant_id: string }[];
}

export function Orders() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("orders")
      .select("id, total, payment_status, created_at, merchant_orders ( id, status, merchant_id )")
      .eq("customer_id", user.id)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setOrders((data as unknown as OrderRow[]) ?? []);
        setLoading(false);
      });
  }, [user]);

  if (loading) return <p className="text-gray-500">Loading orders...</p>;
  if (orders.length === 0) return <p className="text-gray-500">You have no orders yet.</p>;

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">My Orders</h1>
      <div className="space-y-3">
        {orders.map((o) => (
          <Link
            key={o.id}
            to={`/orders/${o.id}`}
            className="block bg-white border rounded-lg p-4 hover:shadow-md transition-shadow"
          >
            <div className="flex justify-between items-center">
              <div>
                <p className="font-medium">Order #{o.id.slice(0, 8)}</p>
                <p className="text-xs text-gray-500">{new Date(o.created_at).toLocaleString()}</p>
              </div>
              <div className="text-right">
                <p className="font-semibold text-emerald-700">{o.total.toFixed(2)} ETB</p>
                <p className="text-xs text-gray-500 capitalize">{o.payment_status}</p>
              </div>
            </div>
            <div className="flex gap-2 mt-2 flex-wrap">
              {o.merchant_orders.map((mo) => (
                <span key={mo.id} className="text-xs bg-gray-100 rounded-full px-2 py-0.5">
                  {STATUS_COPY[mo.status]?.label ?? mo.status.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
