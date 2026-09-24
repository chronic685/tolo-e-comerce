import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
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
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) load();
  }, [user]);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("support_tickets")
      .select("id, subject, body, status, created_at, merchant_order_id, merchant_orders ( order_id, merchants ( business_name ) )")
      .order("created_at", { ascending: false });
    setTickets((data as unknown as SupportTicket[]) ?? []);
    setLoading(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !subject.trim()) return;
    setSubmitting(true);
    setError(null);
    const { data, error } = await supabase
      .from("support_tickets")
      .insert({ user_id: user.id, subject, body: body || null })
      .select("id, subject, body, status, created_at, merchant_order_id")
      .single();
    setSubmitting(false);
    if (error) {
      setError("Could not submit your ticket. Please try again.");
      return;
    }
    // A brand-new ticket never has a merchant_order_id from this form (no
    // "report an issue" flow attaches one here), so merchant_orders is
    // always null for it -- safe to construct locally without a re-fetch.
    setTickets((prev) => [{ ...data, merchant_orders: null }, ...prev]);
    setSubject("");
    setBody("");
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-xl font-bold mb-4">Support</h1>

      <form onSubmit={handleSubmit} className="bg-white border rounded-lg p-4 mb-6 space-y-3">
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
        {error && <p className="text-red-600 text-sm">{error}</p>}
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
        <p className="text-gray-500 text-sm">Loading...</p>
      ) : tickets.length === 0 ? (
        <p className="text-gray-500 text-sm">You haven't contacted support yet.</p>
      ) : (
        <div className="space-y-2">
          {tickets.map((t) => (
            <div key={t.id} className="bg-white border rounded-lg p-3">
              <div className="flex justify-between items-start gap-2">
                <p className="font-medium text-sm">{t.subject}</p>
                <span className="text-xs bg-gray-100 text-gray-700 rounded-full px-2 py-0.5 shrink-0">
                  {STATUS_LABEL[t.status] ?? t.status}
                </span>
              </div>
              {t.body && <p className="text-sm text-gray-600 mt-1">{t.body}</p>}
              {t.merchant_orders && (
                <Link to={`/orders/${t.merchant_orders.order_id}`} className="text-xs text-navy hover:underline mt-1 inline-block">
                  Re: order with {t.merchant_orders.merchants?.business_name ?? "a merchant"} →
                </Link>
              )}
              <p className="text-xs text-gray-400 mt-1">{new Date(t.created_at).toLocaleString()}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
