import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  ADMIN_PAGE_SIZE,
  Badge,
  Button,
  DataTable,
  Pagination,
  SkeletonRows,
  exportToCsv,
  fetchAllRows,
  totalPagesFor,
  usePagination,
  useTranslation,
  type DataTableColumn,
} from "@tolo/ui";
import type { CustomerProfile } from "../types";

export function Customers() {
  const { t } = useTranslation();
  const [customers, setCustomers] = useState<CustomerProfile[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [search, setSearch] = useState("");
  const [committedSearch, setCommittedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [orderCounts, setOrderCounts] = useState<Record<string, number>>({});
  const [reasonPromptId, setReasonPromptId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const { page, from, to, setPage } = usePagination({ pageSize: ADMIN_PAGE_SIZE, resetKey: committedSearch });

  async function load() {
    setLoading(true);
    let query = supabase
      .from("profiles")
      .select("id, full_name, phone, account_status, suspension_reason, created_at", { count: "exact" })
      .eq("role", "customer")
      .order("created_at", { ascending: false });
    if (committedSearch.trim()) query = query.or(`full_name.ilike.%${committedSearch.trim()}%,phone.ilike.%${committedSearch.trim()}%`);
    const { data, count } = await query.range(from, to);
    const rows = (data as CustomerProfile[]) ?? [];
    setCustomers(rows);
    setTotalCount(count ?? 0);
    setLoading(false);

    if (rows.length > 0) {
      const { data: orders } = await supabase
        .from("orders")
        .select("customer_id")
        .in("customer_id", rows.map((r) => r.id));
      const counts: Record<string, number> = {};
      for (const o of orders ?? []) counts[o.customer_id] = (counts[o.customer_id] ?? 0) + 1;
      setOrderCounts(counts);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committedSearch, from, to]);

  // Same reason-prompt pattern as Merchants.tsx: suspending requires a typed
  // reason (stored on profiles.suspension_reason, same mechanism as
  // merchants.suspension_reason, and audit-logged the same way via
  // profiles_log_change/log_config_change — migration 0040). Reactivating
  // is still a single click, matching Merchants.tsx (no reason needed to
  // undo a suspension there either).
  async function toggleStatus(c: CustomerProfile) {
    if (c.account_status === "active") {
      setReasonPromptId(reasonPromptId === c.id ? null : c.id);
      return;
    }
    const { error } = await supabase.from("profiles").update({ account_status: "active" }).eq("id", c.id);
    if (error) return;
    setCustomers((prev) => prev.map((cust) => (cust.id === c.id ? { ...cust, account_status: "active", suspension_reason: null } : cust)));
  }

  async function confirmSuspend(c: CustomerProfile) {
    const suspension_reason = reason || null;
    const { error } = await supabase.from("profiles").update({ account_status: "suspended", suspension_reason }).eq("id", c.id);
    setReasonPromptId(null);
    setReason("");
    if (error) return;
    setCustomers((prev) => prev.map((cust) => (cust.id === c.id ? { ...cust, account_status: "suspended", suspension_reason } : cust)));
  }

  // Item 4 bulk action: suspend every selected active customer under one
  // shared reason, instead of one-at-a-time through the per-row prompt.
  async function bulkSuspend(selected: CustomerProfile[]) {
    const active = selected.filter((c) => c.account_status === "active");
    if (active.length === 0) return;
    const bulkReason = window.prompt(t("customers.bulkSuspendPrompt", { count: active.length }));
    if (bulkReason === null) return;
    await supabase
      .from("profiles")
      .update({ account_status: "suspended", suspension_reason: bulkReason || null })
      .in("id", active.map((c) => c.id));
    setCustomers((prev) =>
      prev.map((c) => (active.some((a) => a.id === c.id) ? { ...c, account_status: "suspended", suspension_reason: bulkReason || null } : c)),
    );
  }

  // Exports every customer matching the current search, not just the page
  // on screen -- fetched fresh here rather than from the paginated
  // `customers` state, which only ever holds one page's worth of rows. Wired
  // into DataTable's onExportAll so the button lives in the table's own
  // toolbar instead of a separate one above it.
  async function handleExportAll() {
    const rows = await fetchAllRows<CustomerProfile>((rangeFrom, rangeTo) => {
      let query = supabase
        .from("profiles")
        .select("id, full_name, phone, account_status, suspension_reason, created_at")
        .eq("role", "customer")
        .order("created_at", { ascending: false });
      if (committedSearch.trim()) query = query.or(`full_name.ilike.%${committedSearch.trim()}%,phone.ilike.%${committedSearch.trim()}%`);
      return query.range(rangeFrom, rangeTo);
    });
    const { data: orders } = await supabase
      .from("orders")
      .select("customer_id")
      .in("customer_id", rows.map((r) => r.id));
    const counts: Record<string, number> = {};
    for (const o of orders ?? []) counts[o.customer_id] = (counts[o.customer_id] ?? 0) + 1;

    exportToCsv(
      `customers-${new Date().toISOString().slice(0, 10)}.csv`,
      rows.map((c) => ({
        id: c.id,
        full_name: c.full_name ?? "",
        phone: c.phone ?? "",
        account_status: c.account_status,
        order_count: counts[c.id] ?? 0,
        registered_at: c.created_at,
      })),
    );
  }

  const columns: DataTableColumn<CustomerProfile>[] = [
    {
      key: "name",
      header: t("common.name"),
      render: (c) => c.full_name ?? t("customers.unnamed"),
      filterValue: (c) => c.full_name ?? "",
      sortValue: (c) => c.full_name ?? "",
      csvValue: (c) => c.full_name ?? "",
    },
    { key: "phone", header: t("common.phone"), render: (c) => c.phone ?? "—", filterValue: (c) => c.phone ?? "", csvValue: (c) => c.phone ?? "" },
    {
      key: "orders",
      header: t("customers.ordersColumn"),
      render: (c) => orderCounts[c.id] ?? 0,
      sortValue: (c) => orderCounts[c.id] ?? 0,
      csvValue: (c) => orderCounts[c.id] ?? 0,
      align: "right",
    },
    {
      key: "joined",
      header: t("customers.joinedColumn"),
      render: (c) => new Date(c.created_at).toLocaleDateString(),
      sortValue: (c) => c.created_at,
      csvValue: (c) => c.created_at,
    },
    {
      key: "status",
      header: t("common.status"),
      render: (c) => (
        <div>
          <Badge variant={c.account_status === "active" ? "success" : "danger"} className="capitalize">
            {c.account_status === "active" ? t("common.active") : t("adminDashboard.stat.suspended")}
          </Badge>
          {c.account_status === "suspended" && c.suspension_reason && (
            <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">{c.suspension_reason}</p>
          )}
        </div>
      ),
      csvValue: (c) => c.account_status,
    },
    {
      key: "actions",
      header: "",
      render: (c) => (
        <div>
          <Button size="sm" variant={c.account_status === "active" ? "outline" : "destructive"} onClick={() => toggleStatus(c)}>
            {c.account_status === "active" ? t("customers.suspend") : t("customers.reactivate")}
          </Button>
          {reasonPromptId === c.id && (
            <div className="flex gap-2 mt-2">
              <input
                placeholder={t("customers.suspensionReasonPlaceholder")}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="flex-1 border rounded-md px-3 py-1.5 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
              />
              <Button size="sm" variant="destructive" onClick={() => confirmSuspend(c)}>
                {t("common.confirm")}
              </Button>
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold dark:text-gray-100">{t("customers.title")}</h1>
      </div>

      <div className="flex gap-2 mb-4 max-w-2xl">
        <input
          placeholder={t("customers.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && setCommittedSearch(search)}
          className="flex-1 border rounded-md px-3 py-2 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
        />
        <button
          onClick={() => setCommittedSearch(search)}
          className="bg-navy dark:bg-navy-light text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-navy-dark dark:hover:bg-navy"
        >
          {t("common.search")}
        </button>
      </div>

      {loading ? (
        <SkeletonRows />
      ) : (
        <>
          <DataTable
            storageKey="admin.customers"
            columns={columns}
            rows={customers}
            getRowId={(c) => c.id}
            bulkActions={[{ label: t("customers.suspend"), onAction: bulkSuspend, variant: "destructive" }]}
            onExportAll={handleExportAll}
            emptyMessage={t("customers.noCustomersFound")}
          />
          <div className="mt-4">
            <Pagination page={page} totalPages={totalPagesFor(totalCount, ADMIN_PAGE_SIZE)} onPageChange={setPage} />
          </div>
        </>
      )}
    </div>
  );
}
