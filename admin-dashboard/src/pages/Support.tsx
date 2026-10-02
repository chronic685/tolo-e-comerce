import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Package, ChevronRight } from "lucide-react";
import { supabase } from "../lib/supabase";
import { ADMIN_PAGE_SIZE, Badge, Button, DataTable, Pagination, SkeletonRows, totalPagesFor, usePagination, useTranslation, type DataTableColumn } from "@tolo/ui";
import type { SupportTicket } from "../types";

const STATUS_KEYS: Record<string, string> = {
  open: "support.status.open",
  in_progress: "support.status.in_progress",
  resolved: "support.status.resolved",
  closed: "support.status.closed",
};

export function Support() {
  const { t } = useTranslation();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const { page, from, to, setPage } = usePagination({ pageSize: ADMIN_PAGE_SIZE });

  async function load() {
    setLoading(true);
    const { data, count } = await supabase
      .from("support_tickets")
      .select("*, merchant_orders ( order_id, merchants ( business_name ) )", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);
    setTickets((data as unknown as SupportTicket[]) ?? []);
    setTotalCount(count ?? 0);
    setLoading(false);
  }

  // Private bucket (migration 0064) -- generated on demand, not stored,
  // same pattern Merchants.tsx uses for merchant-documents.
  async function viewPhoto(ticket: SupportTicket) {
    if (!ticket.photo_url) return;
    const { data, error } = await supabase.storage.from("support-ticket-photos").createSignedUrl(ticket.photo_url, 300);
    if (error || !data) return;
    window.open(data.signedUrl, "_blank");
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  async function setStatus(target: SupportTicket, status: string) {
    const { error } = await supabase.from("support_tickets").update({ status }).eq("id", target.id);
    if (error) return;
    setTickets((prev) => prev.map((ticket) => (ticket.id === target.id ? { ...ticket, status } : ticket)));
  }

  const columns: DataTableColumn<SupportTicket>[] = [
    {
      key: "subject",
      header: t("adminSupport.ticketColumn"),
      render: (ticket) => (
        <div>
          <p className="font-medium text-sm">{ticket.subject}</p>
          {ticket.body && <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">{ticket.body}</p>}
          <div className="flex items-center gap-3 mt-1">
            {ticket.photo_url && (
              <button onClick={() => viewPhoto(ticket)} className="text-xs text-navy dark:text-navy-light hover:underline">
                {t("adminSupport.viewPhoto")}
              </button>
            )}
            {ticket.merchant_orders && (
              <Link to={`/orders?order_id=${ticket.merchant_orders.order_id}`} className="inline-flex items-center gap-1 text-xs text-navy dark:text-navy-light hover:underline">
                <Package className="w-3.5 h-3.5" />
                {t("adminSupport.orderWith", { merchant: ticket.merchant_orders.merchants?.business_name ?? t("adminSupport.merchantFallback") })}
                <ChevronRight className="w-3 h-3" />
              </Link>
            )}
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{new Date(ticket.created_at).toLocaleString()}</p>
        </div>
      ),
      filterValue: (ticket) => ticket.subject,
      sortValue: (ticket) => ticket.created_at,
      csvValue: (ticket) => ticket.subject,
    },
    {
      key: "status",
      header: t("common.status"),
      render: (ticket) => <Badge className="capitalize">{STATUS_KEYS[ticket.status] ? t(STATUS_KEYS[ticket.status]) : ticket.status}</Badge>,
      csvValue: (ticket) => ticket.status,
    },
    {
      key: "actions",
      header: "",
      render: (ticket) => (
        <div className="flex gap-2 justify-end">
          {ticket.status !== "resolved" && (
            <Button size="sm" variant="outline" onClick={() => setStatus(ticket, "resolved")}>
              {t("adminSupport.markResolved")}
            </Button>
          )}
          {ticket.status !== "closed" && (
            <Button size="sm" variant="outline" onClick={() => setStatus(ticket, "closed")}>
              {t("adminSupport.close")}
            </Button>
          )}
          {ticket.status !== "open" && (
            <Button size="sm" variant="outline" onClick={() => setStatus(ticket, "open")}>
              {t("adminSupport.reopen")}
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-bold mb-4 dark:text-gray-100">{t("adminSupport.title")}</h1>
      {loading ? (
        <SkeletonRows />
      ) : tickets.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400">{t("adminSupport.noTickets")}</p>
      ) : (
        <>
          <DataTable storageKey="admin.support" columns={columns} rows={tickets} getRowId={(ticket) => ticket.id} />
          <div className="mt-4">
            <Pagination page={page} totalPages={totalPagesFor(totalCount, ADMIN_PAGE_SIZE)} onPageChange={setPage} />
          </div>
        </>
      )}
    </div>
  );
}
