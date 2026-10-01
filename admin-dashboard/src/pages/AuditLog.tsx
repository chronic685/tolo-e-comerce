import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { exportToCsv } from "../lib/csvExport";
import { ADMIN_PAGE_SIZE, DataTable, fetchAllRows, Pagination, SkeletonRows, totalPagesFor, usePagination, type DataTableColumn } from "@tolo/ui";
import type { AuditLogEntry } from "../types";

const ENTITY_FILTERS = ["all", "system_settings", "commission_rules", "discount_rules", "financial_adjustments", "merchants", "products", "profiles"];

export function AuditLog() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [entityFilter, setEntityFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { page, from, to, setPage } = usePagination({ pageSize: ADMIN_PAGE_SIZE, resetKey: entityFilter });

  async function load() {
    setLoading(true);
    let query = supabase
      .from("audit_logs")
      .select("id, actor_id, action, entity_type, entity_id, metadata, created_at, profiles ( full_name )", { count: "exact" })
      .order("created_at", { ascending: false });
    if (entityFilter !== "all") query = query.eq("entity_type", entityFilter);
    const { data, count } = await query.range(from, to);
    setEntries((data as unknown as AuditLogEntry[]) ?? []);
    setTotalCount(count ?? 0);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityFilter, from, to]);

  // Exports every entry matching the current entity filter, not just the
  // page on screen.
  async function handleExport() {
    const rows = (await fetchAllRows((from, to) => {
      let query = supabase
        .from("audit_logs")
        .select("id, actor_id, action, entity_type, entity_id, metadata, created_at, profiles ( full_name )")
        .order("created_at", { ascending: false });
      if (entityFilter !== "all") query = query.eq("entity_type", entityFilter);
      return query.range(from, to);
    })) as unknown as AuditLogEntry[];
    exportToCsv(
      `audit-log-${entityFilter}-${new Date().toISOString().slice(0, 10)}.csv`,
      rows.map((e) => ({
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

  const columns: DataTableColumn<AuditLogEntry>[] = [
    {
      key: "summary",
      header: "Entry",
      render: (e) => (
        <button onClick={() => setExpandedId(expandedId === e.id ? null : e.id)} className="text-left w-full">
          <p className="text-sm">
            <span className="font-medium">{e.profiles?.full_name ?? "System"}</span>{" "}
            <span className="text-gray-500 dark:text-gray-400 capitalize">{e.action}d</span>{" "}
            <span className="font-medium capitalize">{e.entity_type.replace(/_/g, " ")}</span>
            {e.metadata?.key ? <span className="text-gray-500 dark:text-gray-400"> ({String(e.metadata.key)})</span> : null}
          </p>
          {expandedId === e.id && (
            <pre className="mt-2 bg-gray-50 dark:bg-white/5 border dark:border-white/10 rounded-md p-2 text-xs overflow-x-auto">
              {JSON.stringify(e.metadata, null, 2)}
            </pre>
          )}
        </button>
      ),
      filterValue: (e) => `${e.profiles?.full_name ?? ""} ${e.action} ${e.entity_type}`,
      csvValue: (e) => `${e.action} ${e.entity_type}`,
    },
    {
      key: "created_at",
      header: "Date",
      render: (e) => <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{new Date(e.created_at).toLocaleString()}</span>,
      sortValue: (e) => e.created_at,
      csvValue: (e) => e.created_at,
    },
  ];

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-bold mb-4 dark:text-gray-100">Audit Log</h1>

      <div className="flex gap-2 mb-4 flex-wrap">
        {ENTITY_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setEntityFilter(f)}
            className={`px-3 py-1.5 rounded-full text-xs border capitalize ${
              entityFilter === f ? "bg-navy text-white border-navy dark:bg-navy-light dark:border-navy-light" : "bg-white dark:bg-navy-dark dark:border-white/20 dark:text-gray-300"
            }`}
          >
            {f.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      {loading ? (
        <SkeletonRows />
      ) : entries.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400">No matching audit entries.</p>
      ) : (
        <>
          <DataTable storageKey="admin.auditLog" columns={columns} rows={entries} getRowId={(e) => e.id} onExportAll={handleExport} />
          <div className="mt-4">
            <Pagination page={page} totalPages={totalPagesFor(totalCount, ADMIN_PAGE_SIZE)} onPageChange={setPage} />
          </div>
        </>
      )}
    </div>
  );
}
