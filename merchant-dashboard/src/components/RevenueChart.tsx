import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const WINDOW_OPTIONS = [7, 30, 90] as const;
type WindowDays = (typeof WINDOW_OPTIONS)[number];

interface DayBucket {
  dateKey: string;
  label: string;
  revenue: number;
  orderCount: number;
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Builds one bucket per calendar day in the window (including zero-revenue
// days) so gaps in sales are visible as 0 rows rather than silently
// disappearing from the table.
function buildEmptyBuckets(days: number): DayBucket[] {
  const buckets: DayBucket[] = [];
  const today = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    buckets.push({ dateKey: dateKey(d), label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }), revenue: 0, orderCount: 0 });
  }
  return buckets;
}

export function RevenueChart({ merchantId }: { merchantId: string }) {
  const [windowDays, setWindowDays] = useState<WindowDays>(30);
  const [buckets, setBuckets] = useState<DayBucket[] | null>(null);

  useEffect(() => {
    setBuckets(null);
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - (windowDays - 1));
    windowStart.setHours(0, 0, 0, 0);

    supabase
      .from("merchant_orders")
      .select("created_at, merchant_payable")
      .eq("merchant_id", merchantId)
      .eq("status", "completed")
      .gte("created_at", windowStart.toISOString())
      .then(({ data }) => {
        const rows = (data ?? []) as { created_at: string; merchant_payable: number }[];
        const byDay = new Map<string, { revenue: number; orderCount: number }>();
        for (const row of rows) {
          const key = dateKey(new Date(row.created_at));
          const existing = byDay.get(key) ?? { revenue: 0, orderCount: 0 };
          existing.revenue += row.merchant_payable;
          existing.orderCount += 1;
          byDay.set(key, existing);
        }

        const filled = buildEmptyBuckets(windowDays).map((bucket) => {
          const match = byDay.get(bucket.dateKey);
          return match ? { ...bucket, revenue: match.revenue, orderCount: match.orderCount } : bucket;
        });
        setBuckets(filled);
      });
  }, [merchantId, windowDays]);

  const totalRevenue = buckets?.reduce((sum, b) => sum + b.revenue, 0) ?? 0;
  const totalOrders = buckets?.reduce((sum, b) => sum + b.orderCount, 0) ?? 0;
  const maxRevenue = Math.max(1, ...(buckets?.map((b) => b.revenue) ?? [1]));

  return (
    <div className="bg-white border rounded-lg p-4 mt-6">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div>
          <h2 className="font-semibold">Revenue over time</h2>
          {/* merchant_payable = order subtotal minus platform commission — the
              amount actually credited to this merchant, not the gross order
              value a customer paid. Matches the "You receive" figure shown
              on the order detail page. */}
          <p className="text-xs text-gray-500">Amount you receive per day (after platform commission), completed orders only.</p>
        </div>
        <div className="flex gap-1">
          {WINDOW_OPTIONS.map((opt) => (
            <button
              key={opt}
              onClick={() => setWindowDays(opt)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium border ${
                windowDays === opt ? "bg-navy text-white border-navy" : "bg-white text-gray-600"
              }`}
            >
              {opt}d
            </button>
          ))}
        </div>
      </div>

      {!buckets ? (
        <p className="text-gray-500 text-sm">Loading...</p>
      ) : (
        <>
          <p className="text-sm text-gray-600 mb-3">
            <span className="font-semibold text-gray-900">{totalRevenue.toFixed(2)} ETB</span> total over the last {windowDays} days,
            across {totalOrders} completed order{totalOrders === 1 ? "" : "s"}.
          </p>
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b">
                  <th className="pb-1.5 font-medium">Date</th>
                  <th className="pb-1.5 font-medium">Orders</th>
                  <th className="pb-1.5 font-medium text-right">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {buckets.map((b) => (
                  <tr key={b.dateKey} className="border-b last:border-0">
                    <td className="py-1.5">{b.label}</td>
                    <td className="py-1.5 text-gray-500">{b.orderCount || "—"}</td>
                    <td className="py-1.5">
                      <div className="flex items-center justify-end gap-2">
                        <div className="h-1.5 bg-navy/70 rounded" style={{ width: `${(b.revenue / maxRevenue) * 60}px` }} />
                        <span className="w-20 text-right tabular-nums">{b.revenue > 0 ? `${b.revenue.toFixed(2)} ETB` : "—"}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
