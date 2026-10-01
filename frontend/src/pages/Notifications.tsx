import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { CUSTOMER_PAGE_SIZE, EmptyState, Pagination, SkeletonRows, totalPagesFor, usePagination } from "@tolo/ui";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import type { Notification } from "../types";

export function Notifications() {
  const { user } = useAuth();
  const [items, setItems] = useState<Notification[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { page, from, to, setPage } = usePagination({ pageSize: CUSTOMER_PAGE_SIZE });

  useEffect(() => {
    if (user) load();
  }, [user, from, to]);

  async function load() {
    setLoading(true);
    setError(null);
    const { data, error, count } = await supabase
      .from("notifications")
      .select("id, type, title, body, is_read, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);
    if (error) setError(error.message);
    setItems(data ?? []);
    setTotalCount(count ?? 0);
    setLoading(false);
  }

  async function markRead(id: string) {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    await supabase.from("notifications").update({ is_read: true }).eq("id", id);
  }

  // A real bulk update across every unread row (RLS already scopes this to
  // the signed-in user), not just this page's items -- "mark all read"
  // means all, independent of which page happens to be showing.
  async function markAllRead() {
    if (!items.some((n) => !n.is_read)) return;
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
    await supabase.from("notifications").update({ is_read: true }).eq("is_read", false);
  }

  return (
    <div className="max-w-lg">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">Notifications</h1>
        {items.some((n) => !n.is_read) && (
          <button onClick={markAllRead} className="text-sm text-navy font-medium">
            Mark all read
          </button>
        )}
      </div>

      {loading ? (
        <SkeletonRows count={4} />
      ) : error ? (
        <div className="text-sm">
          <p className="text-red-600 mb-2">We couldn't load your notifications.</p>
          <button onClick={load} className="text-navy font-medium">
            Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={Bell} title="No notifications yet" />
      ) : (
        <>
          <div className="space-y-2">
            {items.map((n) => (
              <button
                key={n.id}
                onClick={() => !n.is_read && markRead(n.id)}
                className={`w-full text-left border rounded-lg p-3 transition-colors ${
                  n.is_read ? "bg-white dark:bg-navy-dark" : "bg-navy-50 border-navy-100"
                }`}
              >
                <div className="flex justify-between items-start gap-2">
                  <p className="font-medium text-sm">{n.title}</p>
                  {!n.is_read && <span className="w-2 h-2 rounded-full bg-orange-500 mt-1.5 shrink-0" aria-label="Unread" />}
                </div>
                {n.body && <p className="text-sm text-gray-600 dark:text-gray-300 mt-0.5">{n.body}</p>}
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{new Date(n.created_at).toLocaleString()}</p>
              </button>
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
