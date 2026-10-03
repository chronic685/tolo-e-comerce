import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { exportToCsv } from "../lib/csvExport";
import { ADMIN_PAGE_SIZE, Badge, DataTable, fetchAllRows, formatCurrency, formatOrderNumber, Pagination, SkeletonRows, totalPagesFor, usePagination, useTranslation, type DataTableColumn } from "@tolo/ui";
import type { OrderRow, UnacknowledgedMerchantOrderRow } from "../types";

const STATUS_KEYS: Record<string, string> = {
  new: "orderStatus.new",
  accepted: "orderStatus.accepted",
  processing: "orderStatus.processing",
  ready_for_pickup: "orderStatus.ready_for_pickup",
  picked_up: "orderStatus.picked_up",
  delivered: "orderStatus.delivered",
  completed: "orderStatus.completed",
  cancelled: "orderStatus.cancelled",
  rejected: "orderStatus.rejected",
};

// Same field the escalate_unacknowledged_orders() cron job reads
// (migration 0033) and the only one an admin can actually edit
// (Settings.tsx, "Escalate to Tolo ops after (minutes)") — this client-side
// heuristic must agree with it, not define its own separate threshold.
// Default of 5 matches that setting's own seeded default (migration 0026).
const DEFAULT_ESCALATE_AFTER_MINUTES = 5;

function isUnacknowledged(mo: { status: string; notification_sent_at: string | null; order_received_at: string | null }, thresholdMinutes: number) {
  if (mo.status !== "new" || !mo.notification_sent_at || mo.order_received_at) return false;
  return Date.now() - new Date(mo.notification_sent_at).getTime() > thresholdMinutes * 60_000;
}

const ORDER_SELECT = `id, order_number, customer_id, total, payment_status, created_at,
   merchant_orders ( id, merchant_id, status, subtotal, notification_sent_at, order_received_at, escalated_at, merchants ( business_name ), delivery_jobs ( needs_manual_handling, handoff_error ) )`;

// Queried directly off merchant_orders (not orders) via
// merchant_orders_unacknowledged() (migration 0055), a computed column
// mirroring escalate_unacknowledged_orders()'s own threshold logic --
// PR #6 review fix: the old `.limit(200)` fetch off `orders` could hide
// older, more-overdue rows past the cap. This is a real, exact-counted,
// .range()-paginated query, so nothing is ever silently hidden.
const UNACKNOWLEDGED_SELECT = `id, merchant_id, status, subtotal, notification_sent_at, order_received_at, escalated_at,
   merchants ( business_name ),
   orders ( id, order_number, total, payment_status, created_at )`;

export function Orders() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const onlyUnacknowledged = searchParams.get("filter") === "unacknowledged";
  // Set from a support ticket's "linked order" reference (Support.tsx) —
  // fetched directly by id rather than relying on the recent-100 list
  // below, since a disputed order could easily be older than that.
  const linkedOrderId = searchParams.get("order_id");
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [unacknowledgedRows, setUnacknowledgedRows] = useState<UnacknowledgedMerchantOrderRow[]>([]);
  const [unacknowledgedTotal, setUnacknowledgedTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [escalateAfterMinutes, setEscalateAfterMinutes] = useState(DEFAULT_ESCALATE_AFTER_MINUTES);
  const { page, from, to, setPage } = usePagination({ pageSize: ADMIN_PAGE_SIZE, resetKey: `${linkedOrderId ?? ""}:${onlyUnacknowledged}` });

  useEffect(() => {
    setLoading(true);
    if (linkedOrderId) {
      supabase
        .from("orders")
        .select(ORDER_SELECT)
        .eq("id", linkedOrderId)
        .then(({ data }) => {
          setOrders((data as unknown as OrderRow[]) ?? []);
          setLoading(false);
        });
      return;
    }
    if (onlyUnacknowledged) {
      supabase
        .from("merchant_orders")
        .select(UNACKNOWLEDGED_SELECT, { count: "exact" })
        .eq("merchant_orders_unacknowledged", true)
        // Oldest-waiting-first -- this is an operational queue meant to be
        // worked down to empty, so the longest-overdue order belongs on
        // page 1, not buried behind however many pages of newer ones.
        .order("notification_sent_at", { ascending: true })
        .range(from, to)
        .then(({ data, count }) => {
          setUnacknowledgedRows((data as unknown as UnacknowledgedMerchantOrderRow[]) ?? []);
          setUnacknowledgedTotal(count ?? 0);
          setLoading(false);
        });
      return;
    }
    supabase
      .from("orders")
      .select(ORDER_SELECT, { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to)
      .then(({ data, count }) => {
        setOrders((data as unknown as OrderRow[]) ?? []);
        setTotalCount(count ?? 0);
        setLoading(false);
      });
  }, [linkedOrderId, onlyUnacknowledged, from, to]);

  useEffect(() => {
    supabase
      .from("system_settings")
      .select("value")
      .eq("key", "merchant_new_order_alerts")
      .maybeSingle()
      .then(({ data }) => {
        const value = data?.value as { escalate_after_minutes?: number } | null;
        if (value?.escalate_after_minutes != null) setEscalateAfterMinutes(value.escalate_after_minutes);
      });
  }, []);

  // The unacknowledged queue exports every row matching the filter (fetched
  // in Supabase's own max_rows-sized pages, see fetchAllRows), the linked-
  // order view exports its single row, and "All Orders" exports everything
  // matching the current view, not just the page on screen -- none of
  // these are capped, so an export is never silently truncated.
  async function handleExport() {
    if (onlyUnacknowledged) {
      const rows = (await fetchAllRows((from_, to_) =>
        supabase
          .from("merchant_orders")
          .select(UNACKNOWLEDGED_SELECT)
          .eq("merchant_orders_unacknowledged", true)
          .order("notification_sent_at", { ascending: true })
          .range(from_, to_),
      )) as unknown as UnacknowledgedMerchantOrderRow[];
      exportToCsv(
        `unacknowledged-orders-${new Date().toISOString().slice(0, 10)}.csv`,
        rows.map((mo) => ({
          merchant_order_id: mo.id,
          order_id: mo.orders?.id ?? "",
          order_number: mo.orders?.order_number ? formatOrderNumber(mo.orders.order_number) : "",
          merchant: mo.merchants?.business_name ?? t("adminOrders.merchantFallback"),
          subtotal_etb: mo.subtotal,
          notification_sent_at: mo.notification_sent_at ?? "",
          escalated: Boolean(mo.escalated_at),
        })),
      );
      return;
    }
    const exportRows = linkedOrderId
      ? orders
      : ((await fetchAllRows((from_, to_) =>
          supabase.from("orders").select(ORDER_SELECT).order("created_at", { ascending: false }).range(from_, to_),
        )) as unknown as OrderRow[]);
    exportToCsv(
      `orders-${new Date().toISOString().slice(0, 10)}.csv`,
      exportRows.map((o) => ({
        id: o.id,
        order_number: formatOrderNumber(o.order_number),
        total_etb: o.total,
        payment_status: o.payment_status,
        created_at: o.created_at,
        merchants: o.merchant_orders.map((mo) => mo.merchants?.business_name ?? t("adminOrders.merchantFallback")).join(" | "),
        merchant_statuses: o.merchant_orders.map((mo) => (STATUS_KEYS[mo.status] ? t(STATUS_KEYS[mo.status]) : mo.status)).join(" | "),
        has_unacknowledged: o.merchant_orders.some((mo) => isUnacknowledged(mo, escalateAfterMinutes)),
      })),
    );
  }

  const unacknowledgedColumns: DataTableColumn<UnacknowledgedMerchantOrderRow>[] = [
    {
      key: "order",
      header: t("adminOrders.orderColumn"),
      render: (mo) => (
        <div>
          <p className="font-medium text-sm">
            {mo.merchants?.business_name ?? t("adminOrders.merchantFallback")} —{" "}
            {mo.orders?.order_number ? t("orders.orderLabel", { orderNumber: formatOrderNumber(mo.orders.order_number) }) : `#${mo.id.slice(0, 8)}`}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {mo.notification_sent_at ? t("adminOrders.notifiedAt", { time: new Date(mo.notification_sent_at).toLocaleString() }) : ""} · {formatCurrency(mo.subtotal)}
          </p>
        </div>
      ),
      filterValue: (mo) => mo.merchants?.business_name ?? "",
      sortValue: (mo) => mo.notification_sent_at ?? "",
      csvValue: (mo) => mo.merchants?.business_name ?? "",
    },
    {
      key: "status",
      header: "",
      render: (mo) => <Badge variant={mo.escalated_at ? "warning" : "danger"}>{mo.escalated_at ? t("adminOrders.escalated") : t("adminOrders.unacknowledged")}</Badge>,
      csvValue: (mo) => (mo.escalated_at ? "escalated" : "unacknowledged"),
    },
  ];

  const orderColumns: DataTableColumn<OrderRow>[] = [
    {
      key: "order",
      header: t("adminOrders.orderColumn"),
      render: (o) => (
        <div>
          <p className="font-medium text-sm">{t("orders.orderLabel", { orderNumber: formatOrderNumber(o.order_number) })}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">{new Date(o.created_at).toLocaleString()}</p>
          <div className="flex gap-1.5 flex-wrap mt-1">
            {o.merchant_orders.map((mo) => (
              <Badge
                key={mo.id}
                variant={mo.escalated_at ? "warning" : isUnacknowledged(mo, escalateAfterMinutes) ? "danger" : "default"}
              >
                {mo.merchants?.business_name ?? t("adminOrders.merchantFallback")}: {STATUS_KEYS[mo.status] ? t(STATUS_KEYS[mo.status]) : mo.status}
                {mo.escalated_at ? t("adminOrders.escalatedSuffix") : isUnacknowledged(mo, escalateAfterMinutes) ? t("adminOrders.unacknowledgedSuffix") : ""}
              </Badge>
            ))}
            {o.merchant_orders
              .filter((mo) => mo.delivery_jobs?.needs_manual_handling)
              .map((mo) => (
                <Badge key={`delivery-${mo.id}`} variant="danger">
                  {mo.merchants?.business_name ?? t("adminOrders.merchantFallback")}:{" "}
                  {mo.delivery_jobs?.handoff_error === "no_verified_phone" ? t("adminOrders.deliveryNoVerifiedPhone") : t("adminOrders.deliveryNeedsManual")}
                </Badge>
              ))}
          </div>
        </div>
      ),
      filterValue: (o) => formatOrderNumber(o.order_number),
      sortValue: (o) => o.created_at,
      csvValue: (o) => formatOrderNumber(o.order_number),
    },
    {
      key: "total",
      header: t("adminOrders.totalColumn"),
      render: (o) => (
        <div className="text-right">
          <p className="font-semibold text-sm">{formatCurrency(o.total)}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">{o.payment_status}</p>
        </div>
      ),
      sortValue: (o) => o.total,
      csvValue: (o) => o.total,
      align: "right",
    },
  ];

  if (loading) return <SkeletonRows />;

  const exportDisabled = onlyUnacknowledged ? unacknowledgedRows.length === 0 : orders.length === 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold dark:text-gray-100">
          {linkedOrderId ? t("adminOrders.fromSupportTicket") : onlyUnacknowledged ? t("adminOrders.unacknowledgedOrdersTitle") : t("adminOrders.allOrdersTitle")}
        </h1>
      </div>

      {onlyUnacknowledged ? (
        unacknowledgedRows.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400">{t("adminOrders.nothingHere")}</p>
        ) : (
          <>
            <DataTable
              storageKey="admin.orders.unacknowledged"
              columns={unacknowledgedColumns}
              rows={unacknowledgedRows}
              getRowId={(mo) => mo.id}
              onExportAll={handleExport}
            />
            <div className="mt-4">
              <Pagination page={page} totalPages={totalPagesFor(unacknowledgedTotal, ADMIN_PAGE_SIZE)} onPageChange={setPage} />
            </div>
          </>
        )
      ) : orders.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400">{t("adminOrders.nothingHere")}</p>
      ) : (
        <>
          <DataTable
            storageKey="admin.orders.all"
            columns={orderColumns}
            rows={orders}
            getRowId={(o) => o.id}
            onExportAll={exportDisabled ? undefined : handleExport}
          />
          {!linkedOrderId && (
            <div className="mt-4">
              <Pagination page={page} totalPages={totalPagesFor(totalCount, ADMIN_PAGE_SIZE)} onPageChange={setPage} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
