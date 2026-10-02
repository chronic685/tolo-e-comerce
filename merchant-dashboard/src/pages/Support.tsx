import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { LifeBuoy } from "lucide-react";
import { ADMIN_PAGE_SIZE, Badge, DataTable, EmptyState, Pagination, SkeletonRows, totalPagesFor, useTranslation, usePagination, type DataTableColumn } from "@tolo/ui";
import { supabase } from "../lib/supabase";
import { useMerchant } from "../lib/MerchantContext";

interface Ticket {
  id: string;
  subject: string;
  body: string | null;
  status: string;
  photo_url: string | null;
  created_at: string;
  merchant_order_id: string | null;
  merchant_orders: { order_id: string } | null;
}

const statusVariant: Record<string, "warning" | "success" | "default"> = {
  open: "warning",
  resolved: "success",
  closed: "default",
};

// Group 4, item 14: support_tickets_select RLS now also lets a merchant
// read a ticket about one of their own merchant_orders (migration 0064) --
// this is the first UI in merchant-dashboard to query it. Read-only:
// support_tickets_update stays admin/reporting-customer only, so there's
// no status-change action here, just visibility.
export function Support() {
  const { merchant } = useMerchant();
  const { t } = useTranslation();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const { page, from, to, setPage } = usePagination({ pageSize: ADMIN_PAGE_SIZE });

  useEffect(() => {
    if (!merchant) return;
    setLoading(true);
    supabase
      .from("support_tickets")
      .select("id, subject, body, status, photo_url, created_at, merchant_order_id, merchant_orders!inner ( order_id, merchant_id )", {
        count: "exact",
      })
      .eq("merchant_orders.merchant_id", merchant.id)
      .order("created_at", { ascending: false })
      .range(from, to)
      .then(({ data, count }) => {
        setTickets((data as unknown as Ticket[]) ?? []);
        setTotalCount(count ?? 0);
        setLoading(false);
      });
  }, [merchant, from, to]);

  async function viewPhoto(ticket: Ticket) {
    if (!ticket.photo_url) return;
    const { data, error } = await supabase.storage.from("support-ticket-photos").createSignedUrl(ticket.photo_url, 300);
    if (error || !data) return;
    window.open(data.signedUrl, "_blank");
  }

  const columns: DataTableColumn<Ticket>[] = [
    {
      key: "subject",
      header: t("support.ticketColumn"),
      render: (ticket) => (
        <div>
          <p className="font-medium text-sm">{ticket.subject}</p>
          {ticket.body && <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">{ticket.body}</p>}
          <div className="flex items-center gap-3 mt-1">
            {ticket.photo_url && (
              <button onClick={() => viewPhoto(ticket)} className="text-xs text-navy dark:text-navy-light hover:underline">
                {t("orders.viewAttachedPhoto")}
              </button>
            )}
            {ticket.merchant_orders && (
              <Link to={`/orders/${ticket.merchant_order_id}`} className="text-xs text-navy dark:text-navy-light hover:underline">
                {t("orders.viewOrder")}
              </Link>
            )}
          </div>
        </div>
      ),
      filterValue: (ticket) => ticket.subject,
      csvValue: (ticket) => ticket.subject,
    },
    {
      key: "status",
      header: t("common.status"),
      render: (ticket) => <Badge variant={statusVariant[ticket.status] ?? "default"}>{t(`support.status.${ticket.status}`)}</Badge>,
      csvValue: (ticket) => ticket.status,
    },
    {
      key: "created_at",
      header: t("common.date"),
      render: (ticket) => <span className="text-xs text-gray-400 dark:text-gray-500">{new Date(ticket.created_at).toLocaleString()}</span>,
      sortValue: (ticket) => ticket.created_at,
      csvValue: (ticket) => ticket.created_at,
    },
  ];

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-bold mb-4 dark:text-gray-100">{t("support.title")}</h1>
      {loading ? (
        <SkeletonRows />
      ) : tickets.length === 0 ? (
        <EmptyState icon={LifeBuoy} title={t("support.empty")} description={t("support.emptyDescription")} />
      ) : (
        <>
          <DataTable storageKey="merchant.support" columns={columns} rows={tickets} getRowId={(ticket) => ticket.id} />
          <div className="mt-4">
            <Pagination page={page} totalPages={totalPagesFor(totalCount, ADMIN_PAGE_SIZE)} onPageChange={setPage} />
          </div>
        </>
      )}
    </div>
  );
}
