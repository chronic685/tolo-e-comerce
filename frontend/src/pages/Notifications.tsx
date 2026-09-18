import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import type { Notification } from "../types";

export function Notifications() {
  const { user } = useAuth();
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) load();
  }, [user]);

  async function load() {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from("notifications")
      .select("id, type, title, body, is_read, created_at")
      .order("created_at", { ascending: false });
    if (error) setError(error.message);
    setItems(data ?? []);
    setLoading(false);
  }

  async function markRead(id: string) {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    await supabase.from("notifications").update({ is_read: true }).eq("id", id);
  }

  async function markAllRead() {
    const unreadIds = items.filter((n) => !n.is_read).map((n) => n.id);
    if (unreadIds.length === 0) return;
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
    await supabase.from("notifications").update({ is_read: true }).in("id", unreadIds);
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
        <p className="text-gray-500">Loading notifications...</p>
      ) : error ? (
        <div className="text-sm">
          <p className="text-red-600 mb-2">We couldn't load your notifications.</p>
          <button onClick={load} className="text-navy font-medium">
            Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        <p className="text-gray-500">You have no notifications yet.</p>
      ) : (
        <div className="space-y-2">
          {items.map((n) => (
            <button
              key={n.id}
              onClick={() => !n.is_read && markRead(n.id)}
              className={`w-full text-left border rounded-lg p-3 transition-colors ${
                n.is_read ? "bg-white" : "bg-navy-50 border-navy-100"
              }`}
            >
              <div className="flex justify-between items-start gap-2">
                <p className="font-medium text-sm">{n.title}</p>
                {!n.is_read && <span className="w-2 h-2 rounded-full bg-orange-500 mt-1.5 shrink-0" aria-label="Unread" />}
              </div>
              {n.body && <p className="text-sm text-gray-600 mt-0.5">{n.body}</p>}
              <p className="text-xs text-gray-400 mt-1">{new Date(n.created_at).toLocaleString()}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
