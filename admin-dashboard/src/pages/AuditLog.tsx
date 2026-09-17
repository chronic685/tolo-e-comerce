import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { exportToCsv } from "../lib/csvExport";
import type { AuditLogEntry } from "../types";

const ENTITY_FILTERS = ["all", "system_settings", "commission_rules", "discount_rules", "merchants", "products", "profiles"];

export function AuditLog() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [entityFilter, setEntityFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    let query = supabase
      .from("audit_logs")
      .select("id, actor_id, action, entity_type, entity_id, metadata, created_at, profiles ( full_name )")
      .order("created_at", { ascending: false })
      .limit(200);
    if (entityFilter !== "all") query = query.eq("entity_type", entityFilter);
    const { data } = await query;
    setEntries((data as unknown as AuditLogEntry[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityFilter]);

  function handleExport() {
    exportToCsv(
      `audit-log-${entityFilter}-${new Date().toISOString().slice(0, 10)}.csv`,
      entries.map((e) => ({
        id: e.id,
        actor: e.profiles?.full_name ?? e.actor_id ?? "system",
        action: e.action,
        entity_type: e.entity_type,
        entity_id: e.entity_id ?? "",
        created_at: e.created_at,
        details: JSON.stringify(e.metadata),
      })),
    );
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">Audit Log</h1>
        <button
          onClick={handleExport}
          disabled={entries.length === 0}
          className="text-xs border px-3 py-1.5 rounded-md hover:bg-gray-50 disabled:opacity-40"
        >
          ⬇ Export CSV
        </button>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {ENTITY_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setEntityFilter(f)}
            className={`px-3 py-1.5 rounded-full text-xs border capitalize ${
              entityFilter === f ? "bg-navy text-white border-navy" : "bg-white"
            }`}
          >
            {f.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : entries.length === 0 ? (
        <p className="text-gray-500">No matching audit entries.</p>
      ) : (
        <div className="bg-white border rounded-lg divide-y">
          {entries.map((e) => (
            <div key={e.id} className="p-3">
              <button
                onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}
                className="w-full flex items-center justify-between text-left"
              >
                <div>
                  <p className="text-sm">
                    <span className="font-medium">{e.profiles?.full_name ?? "System"}</span>{" "}
                    <span className="text-gray-500 capitalize">{e.action}d</span>{" "}
                    <span className="font-medium capitalize">{e.entity_type.replace(/_/g, " ")}</span>
                    {e.metadata?.key ? <span className="text-gray-500"> ({String(e.metadata.key)})</span> : null}
                  </p>
                  <p className="text-xs text-gray-500">{new Date(e.created_at).toLocaleString()}</p>
                </div>
                <span className="text-xs text-gray-400">{expandedId === e.id ? "Hide" : "Details"}</span>
              </button>
              {expandedId === e.id && (
                <pre className="mt-2 bg-gray-50 border rounded-md p-2 text-xs overflow-x-auto">
                  {JSON.stringify(e.metadata, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
