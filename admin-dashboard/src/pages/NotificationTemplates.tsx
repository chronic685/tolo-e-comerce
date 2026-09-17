import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { NotificationTemplate } from "../types";

export function NotificationTemplates() {
  const [templates, setTemplates] = useState<NotificationTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Record<string, { title: string; body: string }>>({});
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("notification_templates").select("*").order("event_type");
    setTemplates((data as NotificationTemplate[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function draft(t: NotificationTemplate) {
    return editing[t.id] ?? { title: t.title_template, body: t.body_template };
  }

  async function save(t: NotificationTemplate) {
    const d = draft(t);
    setMessage(null);
    const { error } = await supabase
      .from("notification_templates")
      .update({ title_template: d.title, body_template: d.body })
      .eq("id", t.id);
    setMessage(error ? error.message : `Saved "${t.event_type}".`);
    await load();
  }

  async function toggleEnabled(t: NotificationTemplate) {
    await supabase.from("notification_templates").update({ enabled: !t.enabled }).eq("id", t.id);
    await load();
  }

  if (loading) return <p className="text-gray-500">Loading...</p>;

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-bold mb-1">Notification Templates</h1>
      <p className="text-sm text-gray-500 mb-4">
        Edit the in-app copy for each event. Use <code>{"{{variable}}"}</code> placeholders — e.g. order_id_short, merchant_name, amount.
      </p>
      {message && <p className="text-sm bg-navy-50 text-navy rounded-md px-3 py-2 mb-4">{message}</p>}

      <div className="space-y-3">
        {templates.map((t) => {
          const d = draft(t);
          const dirty = d.title !== t.title_template || d.body !== t.body_template;
          return (
            <div key={t.id} className="bg-white border rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium capitalize">{t.event_type.replace(/_/g, " ")}</p>
                <button
                  onClick={() => toggleEnabled(t)}
                  className={`text-xs px-2 py-0.5 rounded-full border ${
                    t.enabled ? "bg-emerald-100 text-emerald-800 border-emerald-200" : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {t.enabled ? "Enabled" : "Disabled"}
                </button>
              </div>
              <input
                value={d.title}
                onChange={(e) => setEditing({ ...editing, [t.id]: { ...d, title: e.target.value } })}
                className="w-full border rounded-md px-3 py-2 text-sm mb-2"
              />
              <textarea
                value={d.body}
                onChange={(e) => setEditing({ ...editing, [t.id]: { ...d, body: e.target.value } })}
                rows={2}
                className="w-full border rounded-md px-3 py-2 text-sm"
              />
              {dirty && (
                <button onClick={() => save(t)} className="mt-2 text-xs bg-navy text-white px-3 py-1.5 rounded-md hover:bg-navy-dark">
                  Save changes
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
