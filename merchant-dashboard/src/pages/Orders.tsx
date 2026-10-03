import { Link } from "react-router-dom";
import { Calendar, Inbox } from "lucide-react";
import {
  ADMIN_PAGE_SIZE,
  Badge,
  DataTable,
  EmptyState,
  formatCurrency,
  formatOrderNumber,
  Pagination,
  SkeletonRows,
  totalPagesFor,
  usePagination,
  useTranslation,
  type DataTableColumn,
} from "@tolo/ui";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useMerchant } from "../lib/MerchantContext";
import type { MerchantOrder } from "../types";

const statusVariant: Record<string, "warning" | "info" | "success" | "danger" | "default"> = {
  new: "warning",
  accepted: "info",
  rejected: "danger",
  processing: "info",
  ready_for_pickup: "default",
  picked_up: "default",
  delivered: "success",
  completed: "success",
  cancelled: "danger",
};

// Reuses orderStatus.* -- the same neutral status-badge wording used
// throughout admin-dashboard/frontend, rather than a page-local copy.
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

const FILTERS = ["all", "new", "accepted", "processing", "ready_for_pickup", "completed"];

export function Orders() {
  const { t } = useTranslation();
  const { merchant } = useMerchant();
  const [orders, setOrders] = useState<MerchantOrder[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const { page, from, to, setPage } = usePagination({ pageSize: ADMIN_PAGE_SIZE, resetKey: filter });

  useEffect(() => {
    if (!merchant) return;
    setLoading(true);
    let query = supabase
      .from("merchant_orders")
      .select(
        "id, order_id, merchant_id, status, subtotal, commission_amount, merchant_payable, created_at, scheduled_for, " +
          "order_items ( id, product_name_snapshot, quantity ), orders ( order_number )",
        { count: "exact" },
      )
      .eq("merchant_id", merchant.id)
      .order("created_at", { ascending: false });

    if (filter !== "all") query = query.eq("status", filter);

    query.range(from, to).then(({ data, count }) => {
      setOrders((data as unknown as MerchantOrder[]) ?? []);
      setTotalCount(count ?? 0);
      setLoading(false);
    });
  }, [merchant, filter, from, to]);

  const columns: DataTableColumn<MerchantOrder>[] = [
    {
      key: "order",
      header: t("merchantOrders.orderColumn"),
      render: (o) => (
        <Link to={`/orders/${o.id}`} className="font-medium text-sm hover:text-navy dark:hover:text-navy-light">
          {o.orders?.order_number ? formatOrderNumber(o.orders.order_number) : `#${o.id.slice(0, 8)}`}
        </Link>
      ),
      filterValue: (o) => (o.orders?.order_number ? formatOrderNumber(o.orders.order_number) : o.id),
      csvValue: (o) => (o.orders?.order_number ? formatOrderNumber(o.orders.order_number) : o.id),
    },
    {
      key: "items",
      header: t("merchantOrders.itemsDate"),
      render: (o) => (
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t("merchantOrders.itemCount", { count: o.order_items.length })} · {new Date(o.created_at).toLocaleDateString()}
          </p>
          {o.scheduled_for && (
            <p className="text-xs text-navy dark:text-navy-light font-medium mt-0.5 inline-flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              {t("merchantOrders.scheduledFor", { datetime: new Date(o.scheduled_for).toLocaleString() })}
            </p>
          )}
        </div>
      ),
      sortValue: (o) => o.created_at,
      csvValue: (o) => o.created_at,
    },
    {
      key: "amount",
      header: t("common.amount"),
      render: (o) => <span className="font-semibold text-sm">{formatCurrency(o.merchant_payable)}</span>,
      sortValue: (o) => o.merchant_payable,
      csvValue: (o) => o.merchant_payable,
      align: "right",
    },
    {
      key: "status",
      header: t("common.status"),
      render: (o) => (
        <Badge variant={statusVariant[o.status] ?? "default"}>{STATUS_KEYS[o.status] ? t(STATUS_KEYS[o.status]) : o.status.replace(/_/g, " ")}</Badge>
      ),
      csvValue: (o) => o.status,
    },
  ];

  return (
    <div>
      <h1 className="text-xl font-bold mb-4 dark:text-gray-100">{t("merchantOrders.title")}</h1>
      <div className="flex gap-2 mb-4 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-xs border capitalize ${
              filter === f ? "bg-navy text-white border-navy dark:bg-navy-light dark:border-navy-light" : "bg-white dark:bg-navy-dark dark:border-white/20 dark:text-gray-300"
            }`}
          >
            {f === "all" ? t("marketplace.allCategories") : STATUS_KEYS[f] ? t(STATUS_KEYS[f]) : f.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      {loading ? (
        <SkeletonRows />
      ) : orders.length === 0 ? (
        <EmptyState icon={Inbox} title={t("merchantOrders.noOrdersTitle")} description={t("merchantOrders.noOrdersDescription")} />
      ) : (
        <>
          <DataTable storageKey="merchant.orders" columns={columns} rows={orders} getRowId={(o) => o.id} csvFilename={`orders-${filter}.csv`} />
          <div className="mt-4">
            <Pagination page={page} totalPages={totalPagesFor(totalCount, ADMIN_PAGE_SIZE)} onPageChange={setPage} />
          </div>
        </>
      )}
    </div>
  );
}
