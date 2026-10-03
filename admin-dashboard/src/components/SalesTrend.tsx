import { useEffect, useState } from "react";
import { DateRangePicker, SkeletonRows, fetchAllRows, fetchAllRowsForIds, TrendChart, formatCurrency, lastNDays, useTranslation, type DateRange } from "@tolo/ui";
import { supabase } from "../lib/supabase";

interface DayBucket {
  dateKey: string;
  label: string;
  gmv: number;
  orderCount: number;
}

interface TopProduct {
  name: string;
  quantity: number;
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function buildEmptyBuckets(range: DateRange): DayBucket[] {
  const buckets: DayBucket[] = [];
  const cursor = new Date(range.start);
  while (cursor <= range.end) {
    buckets.push({ dateKey: dateKey(cursor), label: cursor.toLocaleDateString(undefined, { month: "short", day: "numeric" }), gmv: 0, orderCount: 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return buckets;
}

/** Item 3 (Advanced UI pass): platform-wide sales/orders trend with a
 * date-range picker and top products, on top of the Dashboard's existing
 * all-time KPI snapshot. New queries: `orders` filtered to paid + the
 * selected range (for GMV/order-count-by-day), and `merchant_orders` +
 * `order_items` over the same window (for top products by quantity sold) --
 * both client-side aggregated the same way merchant-dashboard's
 * RevenueChart already does, so the two dashboards read consistently.
 * GMV and order count are two different scales, so per the dataviz skill's
 * "never a dual-axis chart" rule these are two small-multiple charts, not
 * one chart with two y-axes. */
export function SalesTrend() {
  const { t } = useTranslation();
  const [range, setRange] = useState<DateRange>(() => lastNDays(30));
  const [buckets, setBuckets] = useState<DayBucket[] | null>(null);
  const [topProducts, setTopProducts] = useState<TopProduct[] | null>(null);
  const rangeStartTime = range.start.getTime();
  const rangeEndTime = range.end.getTime();

  useEffect(() => {
    setBuckets(null);
    setTopProducts(null);
    const startIso = range.start.toISOString();
    const endIso = range.end.toISOString();

    // Paged: one query is capped at 1,000 rows (PostgREST max_rows).
    fetchAllRows<{ created_at: string; total: number }>((from, to) =>
      supabase
        .from("orders")
        .select("created_at, total")
        .eq("payment_status", "paid")
        .gte("created_at", startIso)
        .lte("created_at", endIso)
        .order("id")
        .range(from, to),
    )
      .then((rows) => {
        const byDay = new Map<string, { gmv: number; orderCount: number }>();
        for (const row of rows) {
          const key = dateKey(new Date(row.created_at));
          const existing = byDay.get(key) ?? { gmv: 0, orderCount: 0 };
          existing.gmv += Number(row.total);
          existing.orderCount += 1;
          byDay.set(key, existing);
        }
        setBuckets(buildEmptyBuckets(range).map((b) => ({ ...b, ...(byDay.get(b.dateKey) ?? {}) })));
      })
      .catch(() => setBuckets(buildEmptyBuckets(range)));

    fetchAllRows<{ id: string }>((from, to) =>
      supabase
        .from("merchant_orders")
        .select("id")
        .eq("status", "completed")
        .gte("created_at", startIso)
        .lte("created_at", endIso)
        .order("id")
        .range(from, to),
    )
      .then(async (idRows) => {
        const ids = idRows.map((r) => r.id);
        if (ids.length === 0) {
          setTopProducts([]);
          return;
        }
        const items = await fetchAllRowsForIds<{ product_name_snapshot: string; quantity: number }>(ids, (idChunk, from, to) =>
          supabase.from("order_items").select("product_name_snapshot, quantity").in("merchant_order_id", idChunk).order("id").range(from, to),
        );
        const byProduct = new Map<string, number>();
        for (const item of items) {
          byProduct.set(item.product_name_snapshot, (byProduct.get(item.product_name_snapshot) ?? 0) + item.quantity);
        }
        setTopProducts(
          [...byProduct.entries()]
            .map(([name, quantity]) => ({ name, quantity }))
            .sort((a, b) => b.quantity - a.quantity)
            .slice(0, 5),
        );
      })
      .catch(() => setTopProducts([]));
  }, [rangeStartTime, rangeEndTime]);

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t("adminDashboard.salesTrend")}</h2>
        <DateRangePicker range={range} onChange={setRange} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-navy-dark border dark:border-white/10 rounded-lg p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{t("adminDashboard.gmv")}</p>
          {!buckets ? <SkeletonRows count={3} /> : <TrendChart data={buckets.map((b) => ({ label: b.label, value: b.gmv }))} ariaLabel={t("adminDashboard.gmv")} formatValue={(v) => formatCurrency(v)} />}
        </div>
        <div className="bg-white dark:bg-navy-dark border dark:border-white/10 rounded-lg p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{t("adminDashboard.orderCount")}</p>
          {!buckets ? (
            <SkeletonRows count={3} />
          ) : (
            <TrendChart data={buckets.map((b) => ({ label: b.label, value: b.orderCount }))} ariaLabel={t("adminDashboard.orderCount")} formatValue={(v) => String(v)} />
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-navy-dark border dark:border-white/10 rounded-lg p-4 mt-4">
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wide font-semibold">{t("merchantDashboard.topProducts")}</p>
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
