import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { LifeBuoy } from "lucide-react";
import { ADMIN_PAGE_SIZE, EmptyState, Pagination, SkeletonRows, totalPagesFor, useTranslation, usePagination } from "@tolo/ui";
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

const statusColors: Record<string, string> = {
  open: "bg-yellow-100 text-yellow-800",
  resolved: "bg-emerald-100 text-emerald-800",
  closed: "bg-gray-200 text-gray-700",
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

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-bold mb-4">{t("support.title")}</h1>
      {loading ? (
        <SkeletonRows />
      ) : tickets.length === 0 ? (
        <EmptyState icon={LifeBuoy} title={t("support.empty")} description={t("support.emptyDescription")} />
      ) : (
        <>
          <div className="bg-white border rounded-lg divide-y">
            {tickets.map((ticket) => (
              <div key={ticket.id} className="p-4">
                <div className="flex justify-between items-start mb-1">
                  <p className="font-medium text-sm">{ticket.subject}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[ticket.status] ?? "bg-gray-100"}`}>
                    {t(`support.status.${ticket.status}`)}
                  </span>
                </div>
                {ticket.body && <p className="text-sm text-gray-600 mb-2">{ticket.body}</p>}
                {ticket.photo_url && (
                  <button onClick={() => viewPhoto(ticket)} className="text-xs text-navy hover:underline mb-2 block">
                    {t("orders.viewAttachedPhoto")}
                  </button>
                )}
                {ticket.merchant_orders && (
                  <Link to={`/orders/${ticket.merchant_order_id}`} className="text-xs text-navy hover:underline mb-2 block">
                    {t("orders.viewOrder")}
                  </Link>
                )}
                <p className="text-xs text-gray-400">{new Date(ticket.created_at).toLocaleString()}</p>
              </div>
            ))}
          </div>
          <div className="mt-4">
            <Pagination page={page} totalPages={totalPagesFor(totalCount, ADMIN_PAGE_SIZE)} onPageChange={setPage} />
          </div>
        </>
      )}
    </div>
  );
}
