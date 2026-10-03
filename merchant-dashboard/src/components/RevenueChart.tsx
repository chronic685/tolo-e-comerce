import { useEffect, useState } from "react";
import { DateRangePicker, SkeletonRows, TrendChart, formatCurrency, lastNDays, toDateInputValue, useTranslation, type DateRange } from "@tolo/ui";
import { supabase } from "../lib/supabase";

interface DayBucket {
  dateKey: string;
  label: string;
  revenue: number;
  orderCount: number;
}

interface TopProduct {
  name: string;
  quantity: number;
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Builds one bucket per calendar day in the range (including zero-revenue
// days) so gaps in sales are visible as 0-height bars rather than silently
// disappearing from the chart.
function buildEmptyBuckets(range: DateRange): DayBucket[] {
  const buckets: DayBucket[] = [];
  const cursor = new Date(range.start);
  while (cursor <= range.end) {
    buckets.push({ dateKey: dateKey(cursor), label: cursor.toLocaleDateString(undefined, { month: "short", day: "numeric" }), revenue: 0, orderCount: 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return buckets;
}

export function RevenueChart({ merchantId }: { merchantId: string }) {
  const { t } = useTranslation();
  const [range, setRange] = useState<DateRange>(() => lastNDays(30));
  const [buckets, setBuckets] = useState<DayBucket[] | null>(null);
  const [topProducts, setTopProducts] = useState<TopProduct[] | null>(null);
  const rangeStartTime = range.start.getTime();
  const rangeEndTime = range.end.getTime();

  useEffect(() => {
    setBuckets(null);
    setTopProducts(null);

    const rangeStartIso = range.start.toISOString();
    const rangeEndIso = range.end.toISOString();

    supabase
      .from("merchant_orders")
      .select("id, created_at, merchant_payable")
      .eq("merchant_id", merchantId)
      .eq("status", "completed")
      .gte("created_at", rangeStartIso)
      .lte("created_at", rangeEndIso)
      .then(async ({ data }) => {
        const rows = (data ?? []) as { id: string; created_at: string; merchant_payable: number }[];
        const byDay = new Map<string, { revenue: number; orderCount: number }>();
        for (const row of rows) {
          const key = dateKey(new Date(row.created_at));
          const existing = byDay.get(key) ?? { revenue: 0, orderCount: 0 };
          existing.revenue += row.merchant_payable;
          existing.orderCount += 1;
          byDay.set(key, existing);
        }
        const filled = buildEmptyBuckets(range).map((bucket) => {
          const match = byDay.get(bucket.dateKey);
          return match ? { ...bucket, revenue: match.revenue, orderCount: match.orderCount } : bucket;
        });
        setBuckets(filled);

        // Top products (item 3): aggregate quantity sold across this same
        // completed-order set, across every item on every one of those
        // merchant_orders -- a second query keyed off the same id list
        // rather than a join, since order_items has no merchant_id of its
        // own to filter/range on directly.
        if (rows.length === 0) {
          setTopProducts([]);
          return;
        }
        const { data: items } = await supabase
          .from("order_items")
          .select("product_name_snapshot, quantity")
          .in("merchant_order_id", rows.map((r) => r.id));
        const byProduct = new Map<string, number>();
        for (const item of (items ?? []) as { product_name_snapshot: string; quantity: number }[]) {
          byProduct.set(item.product_name_snapshot, (byProduct.get(item.product_name_snapshot) ?? 0) + item.quantity);
        }
        const top = [...byProduct.entries()]
          .map(([name, quantity]) => ({ name, quantity }))
          .sort((a, b) => b.quantity - a.quantity)
          .slice(0, 5);
        setTopProducts(top);
      });
  }, [merchantId, rangeStartTime, rangeEndTime]);

  const totalRevenue = buckets?.reduce((sum, b) => sum + b.revenue, 0) ?? 0;
  const totalOrders = buckets?.reduce((sum, b) => sum + b.orderCount, 0) ?? 0;

  return (
    <div className="bg-white dark:bg-navy-dark border dark:border-white/10 rounded-lg p-4 mt-6">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div>
          <h2 className="font-semibold dark:text-gray-100">{t("revenueChart.title")}</h2>
          {/* merchant_payable = order subtotal minus platform commission — the
              amount actually credited to this merchant, not the gross order
              value a customer paid. Matches the "You receive" figure shown
              on the order detail page. */}
          <p className="text-xs text-gray-500 dark:text-gray-400">{t("revenueChart.description")}</p>
        </div>
        <DateRangePicker range={range} onChange={setRange} />
      </div>

      {!buckets ? (
        <SkeletonRows count={5} />
      ) : (
        <>
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">
            <span className="font-semibold text-gray-900 dark:text-white">{formatCurrency(totalRevenue)}</span>{" "}
            {t(totalOrders === 1 ? "revenueChart.summaryOne" : "revenueChart.summaryMany", {
              start: toDateInputValue(range.start),
              end: toDateInputValue(range.end),
              count: totalOrders,
            })}
          </p>
          <TrendChart
            data={buckets.map((b) => ({ label: b.label, value: b.revenue }))}
            ariaLabel={t("revenueChart.dailyAriaLabel")}
            formatValue={(v) => formatCurrency(v)}
            height={180}
          />
        </>
      )}

      <div className="mt-6 pt-4 border-t dark:border-white/10">
        <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">{t("merchantDashboard.topProducts")}</h3>
        {!topProducts ? (
          <SkeletonRows count={3} />
        ) : topProducts.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500">{t("dataTable.noRows")}</p>
        ) : (
          <ol className="space-y-1.5">
            {topProducts.map((p, i) => (
              <li key={p.name} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 min-w-0">
                  <span className="text-gray-400 dark:text-gray-500 w-4 flex-shrink-0 tabular-nums">{i + 1}.</span>
                  <span className="truncate dark:text-gray-200">{p.name}</span>
                </span>
                <span className="text-gray-500 dark:text-gray-400 flex-shrink-0 tabular-nums">×{p.quantity}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
