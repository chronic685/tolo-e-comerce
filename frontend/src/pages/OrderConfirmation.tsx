import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";

interface ConfirmationOrderRow {
  id: string;
  total: number;
  created_at: string;
  scheduled_for: string | null;
  addresses: { line1: string; city: string; latitude: number | null; longitude: number | null } | null;
}

// Phase 5d, item 9: previously checkout navigated straight to OrderDetail,
// with no dedicated "your order was placed" moment. Fetches its own data by
// order id (same RLS-scoped pattern as OrderDetail) rather than threading
// checkout's response through router state, so a refresh or a shared link
// still works.
export function OrderConfirmation() {
  const { id } = useParams();
  const [order, setOrder] = useState<ConfirmationOrderRow | null>(null);
  const [etaMinutes, setEtaMinutes] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, [id]);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("orders")
      .select("id, total, created_at, scheduled_for, addresses ( line1, city, latitude, longitude )")
      .eq("id", id)
      .maybeSingle();
    const o = data as unknown as ConfirmationOrderRow | null;
    setOrder(o);

    // A minutes-away ETA is meaningless (and actively misleading) for an
    // order scheduled days out — skip the lookup entirely and show the
    // scheduled time instead, see the render below.
    if (!o?.scheduled_for && o?.addresses?.latitude != null && o.addresses.longitude != null) {
      const { data: minutes } = await supabase.rpc("get_estimated_delivery_minutes", {
        p_latitude: o.addresses.latitude,
        p_longitude: o.addresses.longitude,
      });
      setEtaMinutes(typeof minutes === "number" ? minutes : null);
    }
    setLoading(false);
  }

  if (loading) return <p className="text-gray-500">Loading...</p>;
  if (!order) return <p className="text-gray-500">Order not found.</p>;

  return (
    <div className="max-w-lg text-center">
      <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-3xl mx-auto mb-4">
        ✓
      </div>
      <h1 className="text-xl font-bold mb-1">Order placed!</h1>
      <p className="text-gray-500 text-sm mb-6">Order #{order.id.slice(0, 8)}</p>

      <div className="bg-white border rounded-lg p-4 mb-4 text-left text-sm space-y-2">
        <div className="flex justify-between">
          <span className="text-gray-500">Total</span>
          <span className="font-semibold">{order.total.toFixed(2)} ETB</span>
        </div>
        {order.addresses && (
          <div className="flex justify-between">
            <span className="text-gray-500">Delivering to</span>
            <span>
              {order.addresses.line1}, {order.addresses.city}
            </span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-gray-500">{order.scheduled_for ? "Scheduled for" : "Estimated delivery"}</span>
          <span>
            {order.scheduled_for
              ? new Date(order.scheduled_for).toLocaleString()
              : etaMinutes != null
                ? `~${etaMinutes} min`
                : "We'll confirm shortly"}
          </span>
        </div>
      </div>

      <div className="flex gap-2">
        <Link
          to={`/orders/${order.id}`}
          className="flex-1 bg-navy text-white py-2.5 rounded-md font-medium hover:bg-navy-dark text-sm"
        >
          Track order
        </Link>
        <Link
          to="/"
          className="flex-1 border py-2.5 rounded-md font-medium hover:bg-gray-50 text-sm"
        >
          Continue shopping
        </Link>
      </div>
    </div>
  );
}
