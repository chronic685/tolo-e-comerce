import { useEffect, useState } from "react";
import { Receipt } from "lucide-react";
import { ADMIN_PAGE_SIZE, EmptyState, exportToCsv, Pagination, SkeletonRows, totalPagesFor, usePagination } from "@tolo/ui";
import { supabase } from "../lib/supabase";
import { useMerchant } from "../lib/MerchantContext";
import type { Statement, WalletTransaction } from "../types";

const typeColors: Record<string, string> = {
  sale: "text-emerald-700",
  commission: "text-red-600",
  refund: "text-red-600",
  adjustment: "text-blue-600",
  settlement: "text-gray-600",
};

export function Wallet() {
  const { merchant } = useMerchant();
  const [balance, setBalance] = useState<number | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const { page, from, to, setPage } = usePagination({ pageSize: ADMIN_PAGE_SIZE });

  const [statements, setStatements] = useState<Statement[]>([]);
  const [statementsTotal, setStatementsTotal] = useState(0);
  const statementsPage = usePagination({ pageSize: ADMIN_PAGE_SIZE, paramName: "statements_page" });
  const [downloadingStatementId, setDownloadingStatementId] = useState<string | null>(null);

  useEffect(() => {
    if (!merchant) return;
    supabase.from("merchant_wallets").select("balance").eq("merchant_id", merchant.id).maybeSingle().then(({ data }) => {
      setBalance(data?.balance ?? 0);
    });
  }, [merchant]);

  // Group 3, item 11: period statements -- settlements RLS already let a
  // merchant read their own rows (migration 0051's "is_merchant_owner_or_
  // store_manager" check), just nothing in this app ever queried them.
  useEffect(() => {
    if (!merchant) return;
    supabase
      .from("settlements")
      .select("id, period_start, period_end, total_amount, status, paid_at, created_at", { count: "exact" })
      .eq("merchant_id", merchant.id)
      .order("created_at", { ascending: false })
      .range(statementsPage.from, statementsPage.to)
      .then(({ data, count }) => {
        setStatements((data as Statement[]) ?? []);
        setStatementsTotal(count ?? 0);
      });
  }, [merchant, statementsPage.from, statementsPage.to]);

  // Itemized breakdown for one payout: every order it covers (subtotal,
  // commission, net) plus any refunds against those orders and any
  // financial_adjustments it netted in -- the same shape admin's
  // Settlements.tsx builds for the same settlement, just scoped by RLS to
  // this merchant's own rows.
  async function downloadStatement(s: Statement) {
    setDownloadingStatementId(s.id);
    try {
      const { data: rawItems, error: itemsError } = await supabase
        .from("settlement_items")
        .select("merchant_orders ( id, subtotal, commission_amount, discount_amount, merchant_payable, orders ( order_number ) )")
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

      exportToCsv(`statement-${s.period_start}-${s.period_end}.csv`, [
        ...orderRows,
        ...adjustmentRows,
        { row_type: "TOTAL", reference: "", subtotal_etb: "", commission_etb: "", discount_etb: "", refund_etb: "", net_etb: s.total_amount },
      ]);
    } finally {
      setDownloadingStatementId(null);
    }
  }

  useEffect(() => {
    if (!merchant) return;
    setLoading(true);
    supabase
      .from("wallet_transactions")
      .select("id, type, amount, balance_after, note, created_at", { count: "exact" })
      .eq("merchant_id", merchant.id)
      .order("created_at", { ascending: false })
      .range(from, to)
      .then(({ data, count }) => {
        setTransactions(data ?? []);
        setTotalCount(count ?? 0);
        setLoading(false);
      });
  }, [merchant, from, to]);

  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-bold mb-4">Wallet</h1>

      <div className="bg-white border rounded-lg p-6 mb-4">
        <p className="text-xs text-gray-500">Available balance</p>
        <p className="text-3xl font-bold mt-1">{balance !== null ? `${balance.toFixed(2)} ETB` : "..."}</p>
      </div>

      {loading ? (
        <SkeletonRows />
      ) : transactions.length === 0 ? (
        <div className="bg-white border rounded-lg">
          <EmptyState icon={Receipt} title="No transactions yet" description="Wallet activity from sales and payouts will show up here." />
        </div>
      ) : (
        <>
          <div className="bg-white border rounded-lg divide-y">
            {transactions.map((t) => (
              <div key={t.id} className="flex justify-between items-center p-4">
                <div>
                  <p className="text-sm font-medium capitalize">{t.type}</p>
                  <p className="text-xs text-gray-500">{new Date(t.created_at).toLocaleString()}</p>
                  {t.note && <p className="text-xs text-gray-400">{t.note}</p>}
                </div>
                <div className="text-right">
                  <p className={`font-semibold text-sm ${typeColors[t.type] ?? ""}`}>
                    {t.amount >= 0 ? "+" : ""}
                    {t.amount.toFixed(2)} ETB
                  </p>
                  <p className="text-xs text-gray-400">Balance: {t.balance_after.toFixed(2)}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4">
            <Pagination page={page} totalPages={totalPagesFor(totalCount, ADMIN_PAGE_SIZE)} onPageChange={setPage} />
          </div>
        </>
      )}

      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mt-8 mb-2">Payout Statements</h2>
      {statements.length === 0 ? (
        <p className="text-gray-500 text-sm">No settlements yet — these appear once Tolo runs a payout for a period.</p>
      ) : (
        <>
          <div className="bg-white border rounded-lg divide-y">
            {statements.map((s) => (
              <div key={s.id} className="flex items-center justify-between p-3 gap-3">
                <div>
                  <p className="text-sm font-medium">
                    {s.period_start} → {s.period_end}
                  </p>
                  <p className="text-xs text-gray-500 capitalize">
                    {s.status === "paid" && s.paid_at ? `Paid ${new Date(s.paid_at).toLocaleDateString()}` : s.status}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <p className="font-semibold text-sm">{s.total_amount.toFixed(2)} ETB</p>
                  <button
                    onClick={() => downloadStatement(s)}
                    disabled={downloadingStatementId === s.id}
                    className="text-xs border px-2 py-1 rounded-md hover:bg-gray-50 disabled:opacity-60"
                  >
                    {downloadingStatementId === s.id ? "..." : "Download CSV"}
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4">
            <Pagination
              page={statementsPage.page}
              totalPages={totalPagesFor(statementsTotal, ADMIN_PAGE_SIZE)}
              onPageChange={statementsPage.setPage}
            />
          </div>
        </>
      )}
    </div>
  );
}
