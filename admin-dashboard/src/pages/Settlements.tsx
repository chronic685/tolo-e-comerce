import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { exportToCsv } from "../lib/csvExport";
import {
  ADMIN_PAGE_SIZE,
  Button,
  DataTable,
  ExportCsvButton,
  extractServerErrorText,
  fetchAllRows,
  formatCurrency,
  Pagination,
  toast,
  totalPagesFor,
  translateServerError,
  usePagination,
  useTranslation,
  type DataTableColumn,
} from "@tolo/ui";
import type { FinancialAdjustment, Merchant, Settlement } from "../types";

const ADJUSTMENT_TYPES = ["correction", "bonus", "penalty", "goodwill", "other"];

export function Settlements() {
  const { t } = useTranslation();
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [settlementsTotal, setSettlementsTotal] = useState(0);
  const settlementsPage = usePagination({ pageSize: ADMIN_PAGE_SIZE, paramName: "settlements_page" });
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [merchantId, setMerchantId] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [running, setRunning] = useState(false);
  const [adjustments, setAdjustments] = useState<FinancialAdjustment[]>([]);
  const [adjustmentsTotal, setAdjustmentsTotal] = useState(0);
  const adjustmentsPage = usePagination({ pageSize: ADMIN_PAGE_SIZE, paramName: "adjustments_page" });
  const [showAdjustmentForm, setShowAdjustmentForm] = useState(false);
  const [adjMerchantId, setAdjMerchantId] = useState("");
  const [adjType, setAdjType] = useState(ADJUSTMENT_TYPES[0]);
  const [adjAmount, setAdjAmount] = useState("");
  const [adjReason, setAdjReason] = useState("");

  const [downloadingStatementId, setDownloadingStatementId] = useState<string | null>(null);

  async function load() {
    const { data, count } = await supabase
      .from("settlements")
      .select("id, merchant_id, period_start, period_end, total_amount, status, created_at, paid_at, merchants ( business_name )", {
        count: "exact",
      })
      .order("created_at", { ascending: false })
      .range(settlementsPage.from, settlementsPage.to);
    setSettlements((data as unknown as Settlement[]) ?? []);
    setSettlementsTotal(count ?? 0);
  }

  // Group 3, item 11: admin marks a payout as paid once it's actually
  // been sent -- settlement-run only ever creates settlements as
  // 'pending' (migration 0009's own default); nothing transitioned them
  // further until now.
  async function markPaid(s: Settlement) {
    if (!confirm(`Mark the ${s.total_amount.toFixed(2)} ETB payout to ${s.merchants?.business_name} as paid?`)) return;
    const { error } = await supabase.from("settlements").update({ status: "paid", paid_at: new Date().toISOString() }).eq("id", s.id);
    if (error) {
      toast.error(translateServerError(error.message, t));
      return;
    }
    setSettlements((prev) => prev.map((x) => (x.id === s.id ? { ...x, status: "paid", paid_at: new Date().toISOString() } : x)));
  }

  // Itemized period statement for one payout: every order it covers
  // (subtotal, commission, net) plus any refunds against those orders and
  // any financial_adjustments this settlement netted in -- everything
  // settlement-run actually used to compute total_amount, laid out line
  // by line. Same query shape the merchant-dashboard Wallet page uses for
  // their own statements (RLS scopes it the same way either side).
  async function downloadStatement(s: Settlement) {
    setDownloadingStatementId(s.id);
    try {
      const { data: rawItems, error: itemsError } = await supabase
        .from("settlement_items")
        .select(
          "amount, merchant_orders ( id, subtotal, commission_amount, discount_amount, merchant_payable, orders ( order_number ) )",
        )
        .eq("settlement_id", s.id);
      if (itemsError) throw itemsError;

      const items = (rawItems ?? []) as unknown as {
        merchant_orders: {
          id: string;
          subtotal: number;
          commission_amount: number;
          discount_amount: number;
          merchant_payable: number;
          orders: { order_number: number } | null;
        } | null;
      }[];

      const merchantOrderIds = items.map((i) => i.merchant_orders?.id).filter(Boolean) as string[];
      const refundByMerchantOrder = new Map<string, number>();
      if (merchantOrderIds.length > 0) {
        const { data: returnsRows } = await supabase
          .from("returns")
          .select("merchant_order_id, refunds ( amount, status )")
          .in("merchant_order_id", merchantOrderIds);
        for (const r of (returnsRows as unknown as { merchant_order_id: string; refunds: { amount: number; status: string }[] }[]) ?? []) {
          const refunded = r.refunds.filter((f) => f.status === "completed").reduce((sum, f) => sum + Number(f.amount), 0);
          if (refunded > 0) refundByMerchantOrder.set(r.merchant_order_id, (refundByMerchantOrder.get(r.merchant_order_id) ?? 0) + refunded);
        }
      }

      const { data: adjustments } = await supabase
        .from("financial_adjustments")
        .select("type, amount, reason")
        .eq("settlement_id", s.id);

      const orderRows = items.map((i) => ({
        row_type: "order",
        reference: i.merchant_orders?.orders?.order_number ? `TL-${i.merchant_orders.orders.order_number}` : "",
        subtotal_etb: i.merchant_orders?.subtotal ?? "",
        commission_etb: i.merchant_orders?.commission_amount ?? "",
        discount_etb: i.merchant_orders?.discount_amount ?? "",
        refund_etb: i.merchant_orders ? (refundByMerchantOrder.get(i.merchant_orders.id) ?? 0) : "",
        net_etb: i.merchant_orders?.merchant_payable ?? "",
      }));

      const adjustmentRows = (adjustments ?? []).map((a) => ({
        row_type: `adjustment:${a.type}`,
        reference: a.reason,
        subtotal_etb: "",
        commission_etb: "",
        discount_etb: "",
        refund_etb: "",
        net_etb: a.amount,
      }));

      exportToCsv(`statement-${s.merchants?.business_name ?? s.merchant_id}-${s.period_start}-${s.period_end}.csv`, [
        ...orderRows,
        ...adjustmentRows,
        { row_type: "TOTAL", reference: "", subtotal_etb: "", commission_etb: "", discount_etb: "", refund_etb: "", net_etb: s.total_amount },
      ]);
    } finally {
      setDownloadingStatementId(null);
    }
  }

  async function loadAdjustments() {
    const { data, count } = await supabase
      .from("financial_adjustments")
      .select("id, merchant_id, order_id, settlement_id, type, amount, reason, created_at, merchants ( business_name )", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(adjustmentsPage.from, adjustmentsPage.to);
    setAdjustments((data as unknown as FinancialAdjustment[]) ?? []);
    setAdjustmentsTotal(count ?? 0);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settlementsPage.from, settlementsPage.to]);

  useEffect(() => {
    loadAdjustments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adjustmentsPage.from, adjustmentsPage.to]);

  useEffect(() => {
    supabase.from("merchants").select("id, business_name").eq("status", "active").then(({ data }) => setMerchants((data as Merchant[]) ?? []));
  }, []);

  async function handleAddAdjustment(e: React.FormEvent) {
    e.preventDefault();
    if (!adjMerchantId || !adjAmount || !adjReason.trim()) return;
    const { error } = await supabase.from("financial_adjustments").insert({
      merchant_id: adjMerchantId,
      type: adjType,
      amount: Number(adjAmount),
      reason: adjReason.trim(),
    });
    if (!error) {
      if (adjustmentsPage.page === 1) await loadAdjustments();
      else adjustmentsPage.setPage(1);
      setAdjMerchantId("");
      setAdjAmount("");
      setAdjReason("");
      setShowAdjustmentForm(false);
    }
  }

  async function handleRun(e: React.FormEvent) {
    e.preventDefault();
    if (!merchantId || !periodStart || !periodEnd) return;
    setRunning(true);

    const { data, error } = await supabase.functions.invoke("settlement-run", {
      body: { merchant_id: merchantId, period_start: periodStart, period_end: periodEnd },
    });

    setRunning(false);
    if (error) {
      toast.error(translateServerError(await extractServerErrorText(error), t));
      return;
    }
    toast.success(data?.message ?? `Settled ${data?.total_amount ?? 0} ETB across ${data?.item_count ?? 0} order(s).`);
    // Newest-first ordering means a brand-new settlement always belongs on
    // page 1 -- reload only when that's the page currently showing, and
    // land there otherwise so it's visible.
    if (data?.settlement_id) {
      if (settlementsPage.page === 1) await load();
      else settlementsPage.setPage(1);
    }
  }

  // Exports every settlement, not just the page on screen.
  async function handleExport() {
    const rows = (await fetchAllRows((from, to) =>
      supabase
        .from("settlements")
        .select("id, merchant_id, period_start, period_end, total_amount, status, created_at, merchants ( business_name )")
        .order("created_at", { ascending: false })
        .range(from, to),
    )) as unknown as Settlement[];
    exportToCsv(
      `settlements-${new Date().toISOString().slice(0, 10)}.csv`,
      rows.map((s) => ({
        id: s.id,
        merchant: s.merchants?.business_name ?? "",
        period_start: s.period_start,
        period_end: s.period_end,
        total_amount_etb: s.total_amount,
        status: s.status,
        created_at: s.created_at,
      })),
    );
  }

  const settlementColumns: DataTableColumn<Settlement>[] = [
    {
      key: "merchant",
      header: "Merchant",
      render: (s) => (
        <div>
          <p className="text-sm font-medium">{s.merchants?.business_name}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {s.period_start} → {s.period_end}
          </p>
        </div>
      ),
      filterValue: (s) => s.merchants?.business_name ?? "",
      sortValue: (s) => s.period_start,
      csvValue: (s) => s.merchants?.business_name ?? "",
    },
    {
      key: "amount",
      header: "Amount",
      render: (s) => (
        <div className="text-right">
          <p className="font-semibold text-sm">{formatCurrency(s.total_amount)}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">{s.status === "paid" && s.paid_at ? `Paid ${new Date(s.paid_at).toLocaleDateString()}` : s.status}</p>
        </div>
      ),
      sortValue: (s) => s.total_amount,
      csvValue: (s) => s.total_amount,
      align: "right",
    },
    {
      key: "actions",
      header: "",
      render: (s) => (
        <div className="flex items-center gap-2 justify-end">
          <Button size="sm" variant="outline" onClick={() => downloadStatement(s)} disabled={downloadingStatementId === s.id}>
            {downloadingStatementId === s.id ? "..." : "Statement CSV"}
          </Button>
          {s.status !== "paid" && (
            <Button size="sm" onClick={() => markPaid(s)}>
              Mark as paid
            </Button>
          )}
        </div>
      ),
    },
  ];

  const adjustmentColumns: DataTableColumn<FinancialAdjustment>[] = [
    {
      key: "merchant",
      header: "Adjustment",
      render: (a) => (
        <div>
          <p className="text-sm font-medium">
            {a.merchants?.business_name} · <span className="capitalize">{a.type}</span>
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">{a.reason}</p>
        </div>
      ),
      filterValue: (a) => `${a.merchants?.business_name ?? ""} ${a.type} ${a.reason}`,
      sortValue: (a) => a.created_at,
      csvValue: (a) => a.merchants?.business_name ?? "",
    },
    {
      key: "amount",
      header: "Amount",
      render: (a) => (
        <div className="text-right">
          <p className={`font-semibold text-sm ${a.amount < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}>
            {a.amount >= 0 ? "+" : ""}
            {formatCurrency(a.amount)}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">{new Date(a.created_at).toLocaleDateString()}</p>
        </div>
      ),
      sortValue: (a) => a.amount,
      csvValue: (a) => a.amount,
      align: "right",
    },
  ];

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold dark:text-gray-100">Settlements</h1>
        <ExportCsvButton onExport={handleExport} disabled={settlements.length === 0} />
      </div>

      <form onSubmit={handleRun} className="bg-white dark:bg-navy-dark border dark:border-white/10 rounded-lg p-4 mb-4 flex gap-2 items-end flex-wrap">
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Merchant</label>
          <select value={merchantId} onChange={(e) => setMerchantId(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100">
            <option value="">Select...</option>
            {merchants.map((m) => (
              <option key={m.id} value={m.id}>
                {m.business_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Period start</label>
          <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100" />
        </div>
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Period end</label>
          <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100" />
        </div>
        <button
          type="submit"
          disabled={running}
          className="bg-navy dark:bg-navy-light text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-navy-dark dark:hover:bg-navy disabled:opacity-60"
        >
          {running ? "Running..." : "Run settlement"}
        </button>
      </form>

      <DataTable storageKey="admin.settlements" columns={settlementColumns} rows={settlements} getRowId={(s) => s.id} />
      <div className="mb-6 mt-4">
        <Pagination page={settlementsPage.page} totalPages={totalPagesFor(settlementsTotal, ADMIN_PAGE_SIZE)} onPageChange={settlementsPage.setPage} />
      </div>

      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Financial Adjustments</h2>
        <button onClick={() => setShowAdjustmentForm((s) => !s)} className="text-xs border dark:border-white/20 dark:text-gray-200 px-3 py-1.5 rounded-md hover:bg-gray-50 dark:hover:bg-white/5">
          {showAdjustmentForm ? "Cancel" : "+ New adjustment"}
        </button>
      </div>
      <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">
        A record of manual corrections — this does not itself change settlement totals; it's the audit trail for why one might be adjusted.
      </p>

      {showAdjustmentForm && (
        <form onSubmit={handleAddAdjustment} className="bg-white dark:bg-navy-dark border dark:border-white/10 rounded-lg p-4 mb-4 flex gap-2 items-end flex-wrap">
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Merchant</label>
            <select value={adjMerchantId} onChange={(e) => setAdjMerchantId(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100">
              <option value="">Select...</option>
              {merchants.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.business_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Type</label>
            <select value={adjType} onChange={(e) => setAdjType(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm capitalize dark:bg-navy-dark dark:border-white/20 dark:text-gray-100">
              {ADJUSTMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Amount (ETB, can be negative)</label>
            <input
              type="number"
              value={adjAmount}
              onChange={(e) => setAdjAmount(e.target.value)}
              className="w-32 border rounded-md px-2 py-1.5 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
            />
          </div>
          <input
            placeholder="Reason"
            value={adjReason}
            onChange={(e) => setAdjReason(e.target.value)}
            className="flex-1 min-w-[160px] border rounded-md px-2 py-1.5 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
          />
          <button type="submit" className="bg-navy dark:bg-navy-light text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-navy-dark dark:hover:bg-navy">
            Add
          </button>
        </form>
      )}

      <DataTable storageKey="admin.financialAdjustments" columns={adjustmentColumns} rows={adjustments} getRowId={(a) => a.id} emptyMessage="No adjustments recorded." />
      <div className="mt-4">
        <Pagination page={adjustmentsPage.page} totalPages={totalPagesFor(adjustmentsTotal, ADMIN_PAGE_SIZE)} onPageChange={adjustmentsPage.setPage} />
      </div>
    </div>
  );
}
