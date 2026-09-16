import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useMerchant } from "../lib/MerchantContext";

interface Stats {
  productCount: number;
  newOrders: number;
  completedOrders: number;
  walletBalance: number;
}

export function Dashboard() {
  const { merchant } = useMerchant();
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    if (!merchant) return;

    async function load() {
      const [{ count: productCount }, { count: newOrders }, { count: completedOrders }, { data: wallet }] =
        await Promise.all([
          supabase.from("products").select("id", { count: "exact", head: true }).eq("merchant_id", merchant!.id),
          supabase
            .from("merchant_orders")
            .select("id", { count: "exact", head: true })
            .eq("merchant_id", merchant!.id)
            .eq("status", "new"),
          supabase
            .from("merchant_orders")
            .select("id", { count: "exact", head: true })
            .eq("merchant_id", merchant!.id)
            .eq("status", "completed"),
          supabase.from("merchant_wallets").select("balance").eq("merchant_id", merchant!.id).maybeSingle(),
        ]);

      setStats({
        productCount: productCount ?? 0,
        newOrders: newOrders ?? 0,
        completedOrders: completedOrders ?? 0,
        walletBalance: wallet?.balance ?? 0,
      });
    }

    load();
  }, [merchant]);

  return (
    <div>
      <h1 className="text-xl font-bold mb-1">Welcome back{merchant ? `, ${merchant.business_name}` : ""}</h1>
      <p className="text-sm text-gray-500 mb-6">Here's how your store is doing.</p>

      {!stats ? (
        <p className="text-gray-500">Loading...</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Products" value={stats.productCount} />
          <StatCard label="New Orders" value={stats.newOrders} highlight={stats.newOrders > 0} />
          <StatCard label="Completed Orders" value={stats.completedOrders} />
          <StatCard label="Wallet Balance" value={`${stats.walletBalance.toFixed(2)} ETB`} />
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, highlight }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div className={`bg-white border rounded-lg p-4 ${highlight ? "border-emerald-500" : ""}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}
