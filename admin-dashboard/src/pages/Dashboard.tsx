import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";

interface Stats {
  totalMerchants: number;
  pendingMerchants: number;
  activeMerchants: number;
  totalOrders: number;
  gmv: number;
  commissionEarned: number;
  openTickets: number;
  unacknowledgedOrders: number;
}

export function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    async function load() {
      const { data: settingRow } = await supabase
        .from("system_settings")
        .select("value")
        .eq("key", "unacknowledged_order_escalation_minutes")
        .maybeSingle();
      const thresholdMinutes = Number(settingRow?.value ?? 15);
      const cutoff = new Date(Date.now() - thresholdMinutes * 60_000).toISOString();

      const [
        { count: totalMerchants },
        { count: pendingMerchants },
        { count: activeMerchants },
        { count: totalOrders },
        { data: paidOrders },
        { data: paidMerchantOrders },
        { count: openTickets },
        { count: unacknowledgedOrders },
      ] = await Promise.all([
        supabase.from("merchants").select("id", { count: "exact", head: true }),
        supabase.from("merchants").select("id", { count: "exact", head: true }).eq("status", "registered"),
        supabase.from("merchants").select("id", { count: "exact", head: true }).eq("status", "active"),
        supabase.from("orders").select("id", { count: "exact", head: true }),
        supabase.from("orders").select("total").eq("payment_status", "paid"),
        supabase.from("merchant_orders").select("commission_amount, orders!inner(payment_status)").eq("orders.payment_status", "paid"),
        supabase.from("support_tickets").select("id", { count: "exact", head: true }).eq("status", "open"),
        supabase
          .from("merchant_orders")
          .select("id", { count: "exact", head: true })
          .eq("status", "new")
          .not("notification_sent_at", "is", null)
          .lt("notification_sent_at", cutoff),
      ]);

      const gmv = (paidOrders ?? []).reduce((sum, o) => sum + Number(o.total), 0);
      const commissionEarned = (paidMerchantOrders ?? []).reduce((sum, mo) => sum + Number(mo.commission_amount), 0);

      setStats({
        totalMerchants: totalMerchants ?? 0,
        pendingMerchants: pendingMerchants ?? 0,
        activeMerchants: activeMerchants ?? 0,
        totalOrders: totalOrders ?? 0,
        gmv,
        commissionEarned,
        openTickets: openTickets ?? 0,
        unacknowledgedOrders: unacknowledgedOrders ?? 0,
      });
    }
    load();
  }, []);

  return (
    <div>
      <h1 className="text-xl font-bold mb-1">Platform Overview</h1>
      <p className="text-sm text-gray-500 mb-6">Tolo marketplace at a glance.</p>

      {!stats ? (
        <p className="text-gray-500">Loading...</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <StatCard label="Active Merchants" value={stats.activeMerchants} />
            <StatCard label="Total Orders" value={stats.totalOrders} />
            <StatCard label="GMV (paid)" value={`${stats.gmv.toFixed(2)} ETB`} />
            <StatCard label="Commission Earned" value={`${stats.commissionEarned.toFixed(2)} ETB`} />
          </div>

          {stats.unacknowledgedOrders > 0 && (
            <Link
              to="/orders?filter=unacknowledged"
              className="block bg-red-50 border border-red-300 text-red-800 rounded-lg p-4 mb-4 text-sm font-bold hover:bg-red-100"
            >
              ⚠ {stats.unacknowledgedOrders} order(s) not acknowledged by their merchant — customer may be waiting →
            </Link>
          )}
          {stats.pendingMerchants > 0 && (
            <Link
              to="/merchants?status=registered"
              className="block bg-yellow-50 border border-yellow-300 text-yellow-800 rounded-lg p-4 mb-4 text-sm font-medium hover:bg-yellow-100"
            >
              {stats.pendingMerchants} merchant application(s) awaiting review →
            </Link>
          )}
          {stats.openTickets > 0 && (
            <Link
              to="/support"
              className="block bg-blue-50 border border-blue-300 text-blue-800 rounded-lg p-4 text-sm font-medium hover:bg-blue-100"
            >
              {stats.openTickets} open support ticket(s) →
            </Link>
          )}
        </>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white border rounded-lg p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}
