import { useEffect, useState } from "react";
import { Skeleton } from "@tolo/ui";
import { supabase } from "../lib/supabase";
import { useMerchant } from "../lib/MerchantContext";
import { RevenueChart } from "../components/RevenueChart";
import { LiveOrderQueue } from "../components/LiveOrderQueue";

interface Stats {
  productCount: number;
  newOrders: number;
  completedOrders: number;
  walletBalance: number;
}

interface Performance {
  acceptanceRate: number | null;
  cancellationRate: number | null;
  avgPrepMinutes: number | null;
  avgRating: number | null;
  reviewCount: number;
}

export function Dashboard() {
  const { merchant } = useMerchant();
  const [stats, setStats] = useState<Stats | null>(null);
  const [performance, setPerformance] = useState<Performance | null>(null);

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

  // Group 3, item 12: acceptance rate / cancellation rate / prep speed
  // (migration 0063) alongside the rating computed columns that already
  // existed (merchants_avg_rating/merchants_review_count, migration 0045).
  useEffect(() => {
    if (!merchant) return;
    supabase
      .from("merchants")
      .select(
        "acceptance_rate:merchant_acceptance_rate, cancellation_rate:merchant_cancellation_rate, avg_prep_minutes:merchant_avg_prep_minutes, avg_rating:merchants_avg_rating, review_count:merchants_review_count",
      )
      .eq("id", merchant.id)
      .single()
      .then(({ data }) => {
        if (!data) return;
        setPerformance({
          acceptanceRate: data.acceptance_rate,
          cancellationRate: data.cancellation_rate,
          avgPrepMinutes: data.avg_prep_minutes,
          avgRating: data.avg_rating,
          reviewCount: data.review_count ?? 0,
        });
      });
  }, [merchant]);

  return (
    <div>
      <h1 className="text-xl font-bold mb-1 dark:text-gray-100">Welcome back{merchant ? `, ${merchant.business_name}` : ""}</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Here's how your store is doing.</p>

      {!stats ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Products" value={stats.productCount} />
          <StatCard label="New Orders" value={stats.newOrders} highlight={stats.newOrders > 0} />
          <StatCard label="Completed Orders" value={stats.completedOrders} />
          <StatCard label="Wallet Balance" value={`${stats.walletBalance.toFixed(2)} ETB`} />
        </div>
      )}

      {performance && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Performance</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Acceptance Rate" value={performance.acceptanceRate != null ? `${performance.acceptanceRate}%` : "—"} />
            <StatCard label="Cancellation Rate" value={performance.cancellationRate != null ? `${performance.cancellationRate}%` : "—"} />
            <StatCard label="Avg. Prep Time" value={performance.avgPrepMinutes != null ? `${performance.avgPrepMinutes} min` : "—"} />
            <StatCard
              label="Rating"
              value={performance.avgRating != null ? `${performance.avgRating} ★ (${performance.reviewCount})` : "No reviews yet"}
            />
          </div>
        </div>
      )}

      {merchant && <LiveOrderQueue merchantId={merchant.id} />}
      {merchant && <RevenueChart merchantId={merchant.id} />}
    </div>
  );
}

function StatCard({ label, value, highlight }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div
      className={`bg-white dark:bg-navy-dark border dark:border-white/10 rounded-lg p-4 ${highlight ? "border-emerald-500 dark:border-emerald-500" : ""}`}
    >
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className="text-2xl font-bold mt-1 dark:text-gray-100">{value}</p>
    </div>
  );
}
