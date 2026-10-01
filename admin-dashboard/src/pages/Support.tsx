import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Package, ChevronRight } from "lucide-react";
import { supabase } from "../lib/supabase";
import { ADMIN_PAGE_SIZE, Badge, Button, DataTable, Pagination, SkeletonRows, totalPagesFor, usePagination, type DataTableColumn } from "@tolo/ui";
import type { SupportTicket } from "../types";

export function Support() {
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
  async function viewPhoto(t: SupportTicket) {
    if (!t.photo_url) return;
    const { data, error } = await supabase.storage.from("support-ticket-photos").createSignedUrl(t.photo_url, 300);
    if (error || !data) return;
    window.open(data.signedUrl, "_blank");
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  async function setStatus(t: SupportTicket, status: string) {
    const { error } = await supabase.from("support_tickets").update({ status }).eq("id", t.id);
    if (error) return;
    setTickets((prev) => prev.map((ticket) => (ticket.id === t.id ? { ...ticket, status } : ticket)));
  }

  const columns: DataTableColumn<SupportTicket>[] = [
    {
      key: "subject",
      header: "Ticket",
      render: (t) => (
        <div>
          <p className="font-medium text-sm">{t.subject}</p>
          {t.body && <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">{t.body}</p>}
          <div className="flex items-center gap-3 mt-1">
            {t.photo_url && (
              <button onClick={() => viewPhoto(t)} className="text-xs text-navy dark:text-navy-light hover:underline">
                View attached photo
              </button>
            )}
            {t.merchant_orders && (
              <Link to={`/orders?order_id=${t.merchant_orders.order_id}`} className="inline-flex items-center gap-1 text-xs text-navy dark:text-navy-light hover:underline">
                <Package className="w-3.5 h-3.5" />
                Order with {t.merchant_orders.merchants?.business_name ?? "a merchant"}
                <ChevronRight className="w-3 h-3" />
              </Link>
            )}
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{new Date(t.created_at).toLocaleString()}</p>
        </div>
      ),
      filterValue: (t) => t.subject,
      sortValue: (t) => t.created_at,
      csvValue: (t) => t.subject,
    },
    {
      key: "status",
      header: "Status",
      render: (t) => <Badge className="capitalize">{t.status}</Badge>,
      csvValue: (t) => t.status,
    },
    {
      key: "actions",
      header: "",
      render: (t) => (
        <div className="flex gap-2 justify-end">
          {t.status !== "resolved" && (
            <Button size="sm" variant="outline" onClick={() => setStatus(t, "resolved")}>
              Mark resolved
            </Button>
          )}
          {t.status !== "closed" && (
            <Button size="sm" variant="outline" onClick={() => setStatus(t, "closed")}>
              Close
            </Button>
          )}
          {t.status !== "open" && (
            <Button size="sm" variant="outline" onClick={() => setStatus(t, "open")}>
              Reopen
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-bold mb-4 dark:text-gray-100">Support Tickets</h1>
      {loading ? (
        <SkeletonRows />
      ) : tickets.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400">No support tickets.</p>
      ) : (
        <>
          <DataTable storageKey="admin.support" columns={columns} rows={tickets} getRowId={(t) => t.id} />
          <div className="mt-4">
            <Pagination page={page} totalPages={totalPagesFor(totalCount, ADMIN_PAGE_SIZE)} onPageChange={setPage} />
          </div>
        </>
      )}
    </div>
  );
}
