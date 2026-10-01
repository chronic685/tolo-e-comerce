import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { exportToCsv } from "../lib/csvExport";
import {
  ADMIN_PAGE_SIZE,
  Badge,
  Button,
  DataTable,
  fetchAllRows,
  formatCurrency,
  formatOrderNumber,
  SkeletonRows,
  Pagination,
  toast,
  totalPagesFor,
  usePagination,
  useTranslation,
  type DataTableColumn,
} from "@tolo/ui";
import type { Payment } from "../types";

const STATUS_VARIANT: Record<string, "warning" | "success" | "danger" | "default"> = {
  pending: "warning",
  verified: "success",
  failed: "danger",
  refunded: "default",
};

// Cash, bank transfer and mobile money have no automated gateway (see
// supabase/functions/_shared/payment_providers.ts) — every one of them is
// confirmed by a human, not a webhook. Cash is confirmed by the merchant
// (they physically collect it); bank/mobile-money need Tolo finance to
// reconcile against the real bank/telco statement, since the merchant has
// no way to verify a transfer into Tolo's own account.
// Online gateway payments (Chapa, Telebirr) normally confirm themselves when
// the gateway calls payment-webhook; they are listed here only so finance can
// reconcile one by hand if that callback never arrived (money taken, order
// still pending) -- after checking the payment in the gateway's own dashboard.
const FINANCE_CONFIRMABLE = new Set(["bank_transfer", "mobile_money", "chapa", "telebirr"]);

export function Payments() {
  const { t } = useTranslation();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("pending");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const { page, from, to, setPage } = usePagination({ pageSize: ADMIN_PAGE_SIZE, resetKey: filter });

  async function load() {
    setLoading(true);
    let query = supabase
      .from("payments")
      .select("id, order_id, provider, amount, currency, status, created_at, orders ( order_number, customer_id, profiles ( full_name, phone ) )", {
        count: "exact",
      })
      .order("created_at", { ascending: false });
    if (filter !== "all") query = query.eq("status", filter);
    const { data, count } = await query.range(from, to);
    setPayments((data as unknown as Payment[]) ?? []);
    setTotalCount(count ?? 0);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, from, to]);

  async function handleConfirm(payment: Payment) {
    setConfirmingId(payment.id);
    const { error } = await supabase.functions.invoke("confirm-payment", { body: { payment_id: payment.id } });
    setConfirmingId(null);
    if (error) {
      toast.error(t("merchant.confirmCashFailed"));
      return;
    }
    // The status filter is now a real server-side query param, so a
    // confirmed payment can leave the currently-filtered view (e.g. out of
    // "pending") -- reload rather than patch in place.
    await load();
  }

  // Exports every payment matching the current status filter, not just the
  // page on screen.
  async function handleExport() {
    const rows = (await fetchAllRows((from, to) => {
      let query = supabase
        .from("payments")
        .select("id, order_id, provider, amount, currency, status, created_at, orders ( order_number, customer_id, profiles ( full_name, phone ) )")
        .order("created_at", { ascending: false });
      if (filter !== "all") query = query.eq("status", filter);
      return query.range(from, to);
    })) as unknown as Payment[];
    exportToCsv(
      `payments-${new Date().toISOString().slice(0, 10)}.csv`,
      rows.map((p) => ({
        id: p.id,
        order_id: p.order_id,
        order_number: p.orders?.order_number ?? "",
        customer: p.orders?.profiles?.full_name ?? "",
        provider: p.provider,
        amount_etb: String(p.amount),
        status: p.status,
        created_at: p.created_at,
      })),
    );
  }

  const columns: DataTableColumn<Payment>[] = [
    {
      key: "customer",
      header: "Payment",
      render: (p) => (
        <div>
          <p className="text-sm font-medium">
            {p.orders?.profiles?.full_name ?? "Customer"} · {p.provider.replace(/_/g, " ")}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Order {p.orders?.order_number ? formatOrderNumber(p.orders.order_number) : `#${p.order_id.slice(0, 8)}`} · {new Date(p.created_at).toLocaleString()}
          </p>
        </div>
      ),
      filterValue: (p) => `${p.orders?.profiles?.full_name ?? ""} ${p.provider}`,
      sortValue: (p) => p.created_at,
      csvValue: (p) => p.orders?.profiles?.full_name ?? "",
    },
    {
      key: "amount",
      header: "Amount",
      render: (p) => <span className="font-semibold text-sm">{formatCurrency(p.amount, p.currency)}</span>,
      sortValue: (p) => p.amount,
      csvValue: (p) => p.amount,
      align: "right",
    },
    {
      key: "status",
      header: "Status",
      render: (p) => <Badge variant={STATUS_VARIANT[p.status] ?? "default"}>{p.status}</Badge>,
      csvValue: (p) => p.status,
    },
    {
      key: "actions",
      header: "",
      render: (p) =>
        p.status === "pending" && FINANCE_CONFIRMABLE.has(p.provider) ? (
          <Button size="sm" onClick={() => handleConfirm(p)} disabled={confirmingId === p.id}>
            {confirmingId === p.id ? "Confirming..." : "Confirm received"}
          </Button>
        ) : null,
    },
  ];

  if (loading) return <SkeletonRows />;

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-bold mb-4 dark:text-gray-100">Payments</h1>

      <div className="flex gap-2 mb-4 flex-wrap">
        {["pending", "verified", "failed", "refunded", "all"].map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-full text-sm border capitalize ${filter === s ? "bg-navy text-white border-navy dark:bg-navy-light dark:border-navy-light" : "bg-white dark:bg-navy-dark dark:border-white/20 dark:text-gray-300"}`}
          >
            {s}
          </button>
        ))}
      </div>

      {payments.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400 text-sm">No {filter !== "all" ? filter : ""} payments.</p>
      ) : (
        <>
          <DataTable storageKey="admin.payments" columns={columns} rows={payments} getRowId={(p) => p.id} onExportAll={handleExport} />
          <div className="mt-4">
            <Pagination page={page} totalPages={totalPagesFor(totalCount, ADMIN_PAGE_SIZE)} onPageChange={setPage} />
          </div>
        </>
      )}
    </div>
  );
}
