import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { SupportTicket } from "../types";

export function Support() {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("support_tickets").select("*").order("created_at", { ascending: false });
    setTickets(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function setStatus(t: SupportTicket, status: string) {
    await supabase.from("support_tickets").update({ status }).eq("id", t.id);
    await load();
  }

  if (loading) return <p className="text-gray-500">Loading...</p>;

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-bold mb-4">Support Tickets</h1>
      {tickets.length === 0 ? (
        <p className="text-gray-500">No support tickets.</p>
      ) : (
        <div className="bg-white border rounded-lg divide-y">
          {tickets.map((t) => (
            <div key={t.id} className="p-4">
              <div className="flex justify-between items-start mb-1">
                <p className="font-medium text-sm">{t.subject}</p>
                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 capitalize">{t.status}</span>
              </div>
              {t.body && <p className="text-sm text-gray-600 mb-2">{t.body}</p>}
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
      )}
    </div>
  );
}
