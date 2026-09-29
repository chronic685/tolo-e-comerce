import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Package, ChevronRight } from "lucide-react";
import { supabase } from "../lib/supabase";
import { ADMIN_PAGE_SIZE, Pagination, SkeletonRows, totalPagesFor, usePagination } from "@tolo/ui";
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

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-bold mb-4">Support Tickets</h1>
      {loading ? (
        <SkeletonRows />
      ) : tickets.length === 0 ? (
        <p className="text-gray-500">No support tickets.</p>
      ) : (
        <>
        <div className="bg-white border rounded-lg divide-y">
          {tickets.map((t) => (
            <div key={t.id} className="p-4">
              <div className="flex justify-between items-start mb-1">
                <p className="font-medium text-sm">{t.subject}</p>
                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 capitalize">{t.status}</span>
              </div>
              {t.body && <p className="text-sm text-gray-600 mb-2">{t.body}</p>}
              {t.photo_url && (
                <button onClick={() => viewPhoto(t)} className="text-xs text-navy hover:underline mb-2 block">
                  View attached photo
                </button>
              )}
              {t.merchant_orders && (
                <Link
                  to={`/orders?order_id=${t.merchant_orders.order_id}`}
                  className="inline-flex items-center gap-1 text-xs text-navy hover:underline mb-2"
                >
                  <Package className="w-4 h-4" />
                  Order with {t.merchant_orders.merchants?.business_name ?? "a merchant"}
                  <ChevronRight className="w-3.5 h-3.5" />
                </Link>
              )}
              <p className="text-xs text-gray-400 mb-2">{new Date(t.created_at).toLocaleString()}</p>
              <div className="flex gap-2">
                {t.status !== "resolved" && (
                  <button onClick={() => setStatus(t, "resolved")} className="text-xs border px-2 py-1 rounded-md hover:bg-gray-50">
                    Mark resolved
                  </button>
                )}
                {t.status !== "closed" && (
                  <button onClick={() => setStatus(t, "closed")} className="text-xs border px-2 py-1 rounded-md hover:bg-gray-50">
                    Close
                  </button>
                )}
                {t.status !== "open" && (
                  <button onClick={() => setStatus(t, "open")} className="text-xs border px-2 py-1 rounded-md hover:bg-gray-50">
                    Reopen
                  </button>
                )}
              </div>
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
