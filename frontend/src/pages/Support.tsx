import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, LifeBuoy } from "lucide-react";
import { CUSTOMER_PAGE_SIZE, EmptyState, Pagination, SkeletonRows, toast, totalPagesFor, usePagination, useTranslation } from "@tolo/ui";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import type { SupportTicket } from "../types";

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
};

export function Support() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { page, from, to, setPage } = usePagination({ pageSize: CUSTOMER_PAGE_SIZE });

  useEffect(() => {
    if (user) load();
  }, [user, from, to]);

  async function load() {
    setLoading(true);
    const { data, count } = await supabase
      .from("support_tickets")
      .select("id, subject, body, status, created_at, merchant_order_id, merchant_orders ( order_id, merchants ( business_name ) )", {
        count: "exact",
      })
      .order("created_at", { ascending: false })
      .range(from, to);
    setTickets((data as unknown as SupportTicket[]) ?? []);
    setTotalCount(count ?? 0);
    setLoading(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !subject.trim()) return;
    setSubmitting(true);
    const { data, error } = await supabase
      .from("support_tickets")
      .insert({ user_id: user.id, subject, body: body || null })
      .select("id, subject, body, status, created_at, merchant_order_id")
      .single();
    setSubmitting(false);
    if (error) {
      toast.error(t("support.submitError"));
      return;
    }
    // A brand-new ticket never has a merchant_order_id from this form (no
    // "report an issue" flow attaches one here), so merchant_orders is
    // always null for it -- safe to construct locally without a re-fetch.
    // Only spliced into view when page 1 is showing -- it belongs there
    // (newest first), but on any other page it belongs on page 1, not here.
    if (page === 1) setTickets((prev) => [{ ...data, merchant_orders: null }, ...prev].slice(0, CUSTOMER_PAGE_SIZE));
    setTotalCount((prev) => prev + 1);
    setSubject("");
    setBody("");
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-xl font-bold mb-4">Support</h1>

      <form onSubmit={handleSubmit} className="bg-white dark:bg-navy-dark border rounded-lg p-4 mb-6 space-y-3">
        <h2 className="font-medium text-sm">New ticket</h2>
        <input
          placeholder="Subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          required
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
        <textarea
          placeholder="Describe your issue..."
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={submitting || !subject.trim()}
          className="bg-navy text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-navy-dark disabled:opacity-60"
        >
          {submitting ? "Submitting..." : "Submit ticket"}
        </button>
      </form>

      <h2 className="font-medium text-sm mb-2">Your tickets</h2>
      {loading ? (
        <SkeletonRows count={3} />
      ) : tickets.length === 0 ? (
        <EmptyState icon={LifeBuoy} title="No support tickets yet" description="Need help? Use the form above to reach us." />
      ) : (
        <>
        <div className="space-y-2">
          {tickets.map((t) => (
            <div key={t.id} className="bg-white dark:bg-navy-dark border rounded-lg p-3">
              <div className="flex justify-between items-start gap-2">
                <p className="font-medium text-sm">{t.subject}</p>
                <span className="text-xs bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-gray-300 rounded-full px-2 py-0.5 shrink-0">
                  {STATUS_LABEL[t.status] ?? t.status}
                </span>
              </div>
              {t.body && <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">{t.body}</p>}
              {t.merchant_orders && (
                <Link
                  to={`/orders/${t.merchant_orders.order_id}`}
                  className="text-xs text-navy hover:underline mt-1 inline-flex items-center gap-1"
                >
                  Re: order with {t.merchant_orders.merchants?.business_name ?? "a merchant"}
                  <ChevronRight className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
                </Link>
              )}
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{new Date(t.created_at).toLocaleString()}</p>
            </div>
          ))}
        </div>
        <div className="mt-6">
          <Pagination page={page} totalPages={totalPagesFor(totalCount, CUSTOMER_PAGE_SIZE)} onPageChange={setPage} />
        </div>
        </>
      )}
    </div>
  );
}
