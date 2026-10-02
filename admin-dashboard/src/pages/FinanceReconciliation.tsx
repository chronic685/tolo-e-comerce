import { useEffect, useState } from "react";
import { FileBarChart } from "lucide-react";
import { supabase } from "../lib/supabase";
import { exportToCsv } from "../lib/csvExport";
import { EmptyState, ExportCsvButton, fetchAllRows, SkeletonRows, toast, useTranslation } from "@tolo/ui";

interface Summary {
  orders_count: number;
  orders_subtotal: number;
  orders_discount: number;
  orders_delivery_fee: number;
  orders_rider_tip: number;
  orders_total: number;
  payments_collected: number;
  refunds_issued: number;
  commission_earned: number;
  payouts_paid: number;
}

interface RowDetail {
  order_id: string;
  order_number: number;
  created_at: string;
  customer_name: string;
  subtotal: number;
  discount_amount: number;
  delivery_fee: number;
  rider_tip: number;
  total: number;
  payment_provider: string | null;
  payment_status: string | null;
  payment_amount: number | null;
  refunded_amount: number;
}

function isoStartOfDay(date: string): string {
  return new Date(`${date}T00:00:00`).toISOString();
}
function isoEndOfDay(date: string): string {
  return new Date(`${date}T23:59:59.999`).toISOString();
}
function defaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// Group 4, item 17: orders/payments/refunds/payouts for a given period in
// one place -- Payments.tsx, Refunds.tsx and Settlements.tsx are each
// their own operational queue, none show the full picture together. Both
// finance_reconciliation_summary and _rows (migration 0067) are their own
// authorization boundary (is_tolo_finance() OR the finance_reconciliation
// page grant), independent of this page's own PageGuard.
export function FinanceReconciliation() {
  const { t } = useTranslation();
  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState(today());
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .rpc("finance_reconciliation_summary", { p_from: isoStartOfDay(from), p_to: isoEndOfDay(to) })
      .single();
    if (error) {
      toast.error(t("financeRecon.loadError"));
      setSummary(null);
    } else {
      setSummary(data as unknown as Summary);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleExport() {
    const rows = await fetchAllRows<RowDetail>((rangeFrom, rangeTo) =>
      supabase
        .rpc("finance_reconciliation_rows", { p_from: isoStartOfDay(from), p_to: isoEndOfDay(to) })
        .range(rangeFrom, rangeTo) as unknown as PromiseLike<{ data: RowDetail[] | null; error: { message: string } | null }>,
    );
    exportToCsv(
      `finance-reconciliation-${from}-to-${to}.csv`,
      rows.map((r) => ({
        order_number: `TL-${r.order_number}`,
        date: r.created_at,
        customer: r.customer_name,
        subtotal_etb: r.subtotal,
        discount_etb: r.discount_amount,
        delivery_fee_etb: r.delivery_fee,
        rider_tip_etb: r.rider_tip,
        total_etb: r.total,
        payment_provider: r.payment_provider ?? "",
        payment_status: r.payment_status ?? "",
        payment_amount_etb: r.payment_amount ?? "",
        refunded_etb: r.refunded_amount,
      })),
    );
  }

  const summaryCards = summary
    ? [
        { labelKey: "financeRecon.orders", value: String(summary.orders_count) },
        { labelKey: "financeRecon.orderSubtotal", value: `${summary.orders_subtotal.toFixed(2)} ETB` },
        { labelKey: "financeRecon.discounts", value: `-${summary.orders_discount.toFixed(2)} ETB` },
        { labelKey: "financeRecon.deliveryFees", value: `${summary.orders_delivery_fee.toFixed(2)} ETB` },
        { labelKey: "financeRecon.riderTips", value: `${summary.orders_rider_tip.toFixed(2)} ETB` },
        { labelKey: "financeRecon.orderTotal", value: `${summary.orders_total.toFixed(2)} ETB` },
        { labelKey: "financeRecon.paymentsCollected", value: `${summary.payments_collected.toFixed(2)} ETB` },
        { labelKey: "financeRecon.refundsIssued", value: `${summary.refunds_issued.toFixed(2)} ETB` },
        { labelKey: "financeRecon.commissionEarned", value: `${summary.commission_earned.toFixed(2)} ETB` },
        { labelKey: "financeRecon.payoutsPaid", value: `${summary.payouts_paid.toFixed(2)} ETB` },
      ]
    : [];

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">{t("financeRecon.title")}</h1>
        <ExportCsvButton onExport={handleExport} disabled={!summary || summary.orders_count === 0} />
      </div>

      <div className="bg-white dark:bg-navy-dark border rounded-lg p-4 mb-4 flex items-end gap-3">
        <label className="text-sm">
          <span className="block text-gray-500 dark:text-gray-400 mb-1">{t("financeRecon.from")}</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm" />
        </label>
        <label className="text-sm">
          <span className="block text-gray-500 dark:text-gray-400 mb-1">{t("financeRecon.to")}</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm" />
        </label>
        <button onClick={load} className="bg-navy text-white px-4 py-1.5 rounded-md text-sm font-medium hover:bg-navy-dark">
          {t("financeRecon.runReport")}
        </button>
      </div>

      {loading ? (
        <SkeletonRows />
      ) : !summary || summary.orders_count === 0 ? (
        <EmptyState icon={FileBarChart} title={t("financeRecon.emptyTitle")} description={t("financeRecon.emptyDescription")} />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {summaryCards.map((c) => (
            <div key={c.labelKey} className="bg-white dark:bg-navy-dark border rounded-lg p-3">
              <p className="text-xs text-gray-500 dark:text-gray-400">{t(c.labelKey)}</p>
              <p className="text-lg font-semibold">{c.value}</p>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">{t("financeRecon.footnote")}</p>
    </div>
  );
}
