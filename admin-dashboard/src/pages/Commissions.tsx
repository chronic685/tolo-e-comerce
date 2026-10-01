import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { ADMIN_PAGE_SIZE, Badge, Button, DataTable, Pagination, toast, totalPagesFor, usePagination, type DataTableColumn } from "@tolo/ui";
import type { Category, CommissionRule, Merchant } from "../types";

export function Commissions() {
  const [rules, setRules] = useState<CommissionRule[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const { page, from, to, setPage } = usePagination({ pageSize: ADMIN_PAGE_SIZE });
  const [categories, setCategories] = useState<Category[]>([]);
  const [merchants, setMerchants] = useState<Merchant[]>([]);

  const [scopeType, setScopeType] = useState("platform");
  const [scopeId, setScopeId] = useState("");
  const [rate, setRate] = useState("5");
  const [editingId, setEditingId] = useState<string | null>(null);

  async function load() {
    const { data, count } = await supabase.from("commission_rules").select("*", { count: "exact" }).order("scope_type").range(from, to);
    setRules(data ?? []);
    setTotalCount(count ?? 0);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  useEffect(() => {
    supabase.from("categories").select("id, name, slug").then(({ data }) => setCategories((data as Category[]) ?? []));
    supabase.from("merchants").select("id, business_name").eq("status", "active").then(({ data }) => setMerchants((data as Merchant[]) ?? []));
  }, []);

  // Editing an existing rule's rate/scope only ever changes what future
  // create_order() calls see (get_commission_rate() is read live at
  // order-creation time and the result is snapshotted onto
  // merchant_orders.commission_rate_applied/commission_amount) — past
  // orders already carry their own snapshot and are never recalculated
  // from commission_rules again. Editing here is safe by construction, not
  // just by convention.
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      scope_type: scopeType,
      scope_id: scopeType === "platform" ? null : scopeId || null,
      rate_percent: Number(rate),
    };
    const { data, error } = editingId
      ? await supabase.from("commission_rules").update(payload).eq("id", editingId).select().single()
      : await supabase.from("commission_rules").insert(payload).select().single();
    if (error) {
      toast.error(error.message);
      return;
    }
    if (editingId) setRules((prev) => prev.map((r) => (r.id === editingId ? data : r)));
    else await load();
    resetForm();
  }

  function startEdit(r: CommissionRule) {
    setEditingId(r.id);
    setScopeType(r.scope_type);
    setScopeId(r.scope_id ?? "");
    setRate(String(r.rate_percent));
  }

  function resetForm() {
    setEditingId(null);
    setScopeType("platform");
    setScopeId("");
    setRate("5");
  }

  async function toggleActive(r: CommissionRule) {
    const { error } = await supabase.from("commission_rules").update({ is_active: !r.is_active }).eq("id", r.id);
    if (error) return;
    setRules((prev) => prev.map((rule) => (rule.id === r.id ? { ...rule, is_active: !rule.is_active } : rule)));
  }

  function labelFor(r: CommissionRule) {
    if (r.scope_type === "platform") return "Platform default";
    if (r.scope_type === "category") return categories.find((c) => c.id === r.scope_id)?.name ?? r.scope_id;
    if (r.scope_type === "merchant") return merchants.find((m) => m.id === r.scope_id)?.business_name ?? r.scope_id;
    return r.scope_id;
  }

  const columns: DataTableColumn<CommissionRule>[] = [
    {
      key: "scope",
      header: "Scope",
      render: (r) => (
        <span>
          <span className="text-xs uppercase text-gray-400 dark:text-gray-500 mr-2">{r.scope_type}</span>
          <span className="text-sm dark:text-gray-200">{labelFor(r)}</span>
        </span>
      ),
      filterValue: (r) => labelFor(r) ?? "",
      csvValue: (r) => labelFor(r) ?? "",
    },
    {
      key: "rate",
      header: "Rate",
      render: (r) => <span className="font-semibold text-sm">{r.rate_percent}%</span>,
      sortValue: (r) => r.rate_percent,
      csvValue: (r) => r.rate_percent,
      align: "right",
    },
    {
      key: "status",
      header: "Status",
      render: (r) => <Badge variant={r.is_active ? "success" : "default"}>{r.is_active ? "Active" : "Inactive"}</Badge>,
      csvValue: (r) => (r.is_active ? "active" : "inactive"),
    },
    {
      key: "actions",
      header: "",
      render: (r) => (
        <div className="flex items-center gap-2 justify-end">
          <Button size="sm" variant="outline" onClick={() => startEdit(r)}>
            Edit
          </Button>
          <Button size="sm" variant="outline" onClick={() => toggleActive(r)}>
            {r.is_active ? "Deactivate" : "Activate"}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-bold mb-4 dark:text-gray-100">Commission Rules</h1>

      <form onSubmit={handleSubmit} className="bg-white dark:bg-navy-dark border dark:border-white/10 rounded-lg p-4 mb-4 flex gap-2 items-end flex-wrap">
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Scope</label>
          <select value={scopeType} onChange={(e) => setScopeType(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100">
            <option value="platform">Platform</option>
            <option value="category">Category</option>
            <option value="merchant">Merchant</option>
          </select>
        </div>
        {scopeType !== "platform" && (
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{scopeType === "category" ? "Category" : "Merchant"}</label>
            <select value={scopeId} onChange={(e) => setScopeId(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100">
              <option value="">Select...</option>
              {(scopeType === "category" ? categories : merchants).map((item) => (
                <option key={item.id} value={item.id}>
                  {"name" in item ? item.name : item.business_name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Rate (%)</label>
          <input
            type="number"
            step="0.1"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            className="border rounded-md px-2 py-1.5 text-sm w-24 dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
          />
        </div>
        <button type="submit" className="bg-navy dark:bg-navy-light text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-navy-dark dark:hover:bg-navy">
          {editingId ? "Save changes" : "Add rule"}
        </button>
        {editingId && (
          <button type="button" onClick={resetForm} className="text-sm text-gray-500 dark:text-gray-400 px-2 py-2">
            Cancel
          </button>
        )}
      </form>

      <DataTable storageKey="admin.commissions" columns={columns} rows={rules} getRowId={(r) => r.id} />
      <div className="mt-4">
        <Pagination page={page} totalPages={totalPagesFor(totalCount, ADMIN_PAGE_SIZE)} onPageChange={setPage} />
      </div>
    </div>
  );
}
