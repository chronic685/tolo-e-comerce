import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { SkeletonPage, toast, translateServerError, useTranslation } from "@tolo/ui";
import type { NotificationTemplate } from "../types";

export function NotificationTemplates() {
  // Aliased: this file already uses `t` for a NotificationTemplate
  // parameter throughout (draft(t), save(t), below).
  const { t: translate } = useTranslation();
  const [templates, setTemplates] = useState<NotificationTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Record<string, { title: string; body: string }>>({});

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
    const { error } = await supabase
      .from("notification_templates")
      .update({ title_template: d.title, body_template: d.body })
      .eq("id", t.id);
    if (error) {
      toast.error(translateServerError(error.message, translate));
      return;
    }
    toast.success(translate("notificationTemplates.saved", { eventType: t.event_type }));
    setTemplates((prev) => prev.map((tpl) => (tpl.id === t.id ? { ...tpl, title_template: d.title, body_template: d.body } : tpl)));
    // Clears this row's draft now that it matches the saved value, so
    // `dirty` goes back to false and the Save button disappears again --
    // previously implicit in the full re-fetch, which re-derived every
    // draft from fresh server data.
    setEditing((prev) => {
      const next = { ...prev };
      delete next[t.id];
      return next;
    });
  }

  async function toggleEnabled(t: NotificationTemplate) {
    const { error } = await supabase.from("notification_templates").update({ enabled: !t.enabled }).eq("id", t.id);
    if (error) return;
    setTemplates((prev) => prev.map((tpl) => (tpl.id === t.id ? { ...tpl, enabled: !tpl.enabled } : tpl)));
  }

  if (loading) return <SkeletonPage />;

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-bold mb-1">{translate("notificationTemplates.title")}</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        {translate("notificationTemplates.descriptionBefore")} <code>{"{{variable}}"}</code> {translate("notificationTemplates.descriptionAfter")}
      </p>

      <div className="space-y-3">
        {templates.map((t) => {
          const d = draft(t);
          const dirty = d.title !== t.title_template || d.body !== t.body_template;
          return (
            <div key={t.id} className="bg-white dark:bg-navy-dark border rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium capitalize">{t.event_type.replace(/_/g, " ")}</p>
                <button
                  onClick={() => toggleEnabled(t)}
                  className={`text-xs px-2 py-0.5 rounded-full border ${
                    t.enabled ? "bg-emerald-100 text-emerald-800 border-emerald-200" : "bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300"
                  }`}
                >
                  {t.enabled ? translate("notificationTemplates.enabled") : translate("notificationTemplates.disabled")}
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
                  {translate("notificationTemplates.saveChanges")}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
