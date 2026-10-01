import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Package } from "lucide-react";
import {
  Badge,
  Button,
  CUSTOMER_PAGE_SIZE,
  EmptyState,
  formatOrderNumber,
  Pagination,
  SkeletonRows,
  totalPagesFor,
  useTranslation,
  usePagination,
} from "@tolo/ui";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { useStatusCopy } from "../lib/orderStatus";
import { statusBadgeVariant } from "../lib/orderTrack";

interface OrderRow {
  id: string;
  order_number: number;
  total: number;
  payment_status: string;
  created_at: string;
  merchant_orders: { id: string; status: string; merchant_id: string }[];
}

export function Orders() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const statusCopy = useStatusCopy();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const { page, from, to, setPage } = usePagination({ pageSize: CUSTOMER_PAGE_SIZE });

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    supabase
      .from("orders")
      .select("id, order_number, total, payment_status, created_at, merchant_orders ( id, status, merchant_id )", { count: "exact" })
      .eq("customer_id", user.id)
      .order("created_at", { ascending: false })
      .range(from, to)
      .then(({ data, count }) => {
        setOrders((data as unknown as OrderRow[]) ?? []);
        setTotalCount(count ?? 0);
        setLoading(false);
      });
  }, [user, from, to]);

  if (loading) return <SkeletonRows count={4} />;
  if (orders.length === 0)
    return (
      <EmptyState
        icon={Package}
        title={t("orders.empty")}
        description={t("orders.emptyDescription")}
        action={<Button onClick={() => navigate("/")}>{t("cart.browseMarketplace")}</Button>}
      />
    );

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">{t("orders.title")}</h1>
      <div className="space-y-3">
        {orders.map((o) => (
          <Link
            key={o.id}
            to={`/orders/${o.id}`}
            className="block bg-white dark:bg-navy-dark border rounded-lg p-4 hover:shadow-md transition-shadow"
          >
            <div className="flex justify-between items-center">
              <div>
                <p className="font-medium">{t("orders.orderLabel", { orderNumber: formatOrderNumber(o.order_number) })}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{new Date(o.created_at).toLocaleString()}</p>
              </div>
              <div className="text-right">
                <p className="font-semibold text-navy">{o.total.toFixed(2)} ETB</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">{o.payment_status}</p>
              </div>
            </div>
            <div className="flex gap-2 mt-2 flex-wrap">
              {o.merchant_orders.map((mo) => (
                <Badge key={mo.id} variant={statusBadgeVariant(mo.status)}>
                  {statusCopy[mo.status]?.label ?? mo.status.replace(/_/g, " ")}
                </Badge>
              ))}
            </div>
          </Link>
        ))}
      </div>
      <div className="mt-6">
        <Pagination page={page} totalPages={totalPagesFor(totalCount, CUSTOMER_PAGE_SIZE)} onPageChange={setPage} />
      </div>
    </div>
  );
}
