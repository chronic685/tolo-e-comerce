import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { STATUS_COPY } from "../lib/orderStatus";

interface OrderItemRow {
  id: string;
  product_name_snapshot: string;
  variant_attributes_snapshot: Record<string, string>;
  unit_price: number;
  quantity: number;
  subtotal: number;
}

interface MerchantOrderRow {
  id: string;
  status: string;
  subtotal: number;
  merchants: { business_name: string } | null;
  order_items: OrderItemRow[];
  order_status_history: { status: string; changed_at: string; note: string | null }[];
}

interface OrderRow {
  id: string;
  total: number;
  delivery_fee: number;
  payment_status: string;
  created_at: string;
  addresses: { recipient_name: string; line1: string; city: string; phone: string } | null;
  merchant_orders: MerchantOrderRow[];
}

export function OrderDetail() {
  const { id } = useParams();
  const [order, setOrder] = useState<OrderRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("orders")
      .select(
        `id, total, delivery_fee, payment_status, created_at,
         addresses ( recipient_name, line1, city, phone ),
         merchant_orders (
           id, status, subtotal,
           merchants ( business_name ),
           order_items ( id, product_name_snapshot, variant_attributes_snapshot, unit_price, quantity, subtotal ),
           order_status_history ( status, changed_at, note )
         )`,
      )
      .eq("id", id)
      .maybeSingle()
      .then(({ data }) => {
        setOrder(data as unknown as OrderRow | null);
        setLoading(false);
      });
  }, [id]);

  if (loading) return <p className="text-gray-500">Loading order...</p>;
  if (!order) return <p className="text-gray-500">Order not found.</p>;

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-bold mb-1">Order #{order.id.slice(0, 8)}</h1>
      <p className="text-sm text-gray-500 mb-6">{new Date(order.created_at).toLocaleString()}</p>

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
            <p className="font-medium">{mo.merchants?.business_name}</p>
            <span className="text-xs bg-emerald-100 text-emerald-800 rounded-full px-2 py-0.5">
              {STATUS_COPY[mo.status]?.label ?? mo.status.replace(/_/g, " ")}
            </span>
          </div>
          {STATUS_COPY[mo.status] && <p className="text-xs text-gray-500 mb-2">{STATUS_COPY[mo.status].detail}</p>}
          <div className="space-y-1 mb-3">
            {mo.order_items.map((item) => (
              <div key={item.id} className="flex justify-between text-sm">
                <span>
                  {item.product_name_snapshot}
                  {Object.values(item.variant_attributes_snapshot ?? {}).length > 0 &&
                    ` (${Object.values(item.variant_attributes_snapshot).join(" / ")})`}{" "}
                  × {item.quantity}
                </span>
                <span>{item.subtotal.toFixed(2)} ETB</span>
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
        </div>
      ))}

      <div className="bg-white border rounded-lg p-4 flex justify-between font-semibold">
        <span>Total ({order.payment_status})</span>
        <span>{order.total.toFixed(2)} ETB</span>
      </div>
    </div>
  );
}
