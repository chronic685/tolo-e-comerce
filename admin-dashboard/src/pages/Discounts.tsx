import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  ADMIN_PAGE_SIZE,
  Badge,
  Button,
  DataTable,
  exportToCsv,
  fetchAllRows,
  Pagination,
  toast,
  totalPagesFor,
  translateServerError,
  usePagination,
  useTranslation,
  type DataTableColumn,
} from "@tolo/ui";
import type { Category, DiscountRule, Merchant } from "../types";

const emptyForm = {
  name: "",
  description: "",
  scope_type: "platform" as DiscountRule["scope_type"],
  scope_id: "",
  code: "",
  discount_kind: "percent" as DiscountRule["discount_kind"],
  amount: "10",
  max_discount_amount: "",
  min_order_value: "0",
  funded_by: "tolo" as DiscountRule["funded_by"],
  tolo_share_percent: "50",
  usage_limit: "",
  per_customer_limit: "",
  first_order_only: false,
  starts_at: "",
  ends_at: "",
};

export function Discounts() {
  const { t } = useTranslation();
  const [rules, setRules] = useState<DiscountRule[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const { page, from, to, setPage } = usePagination({ pageSize: ADMIN_PAGE_SIZE });
  const [categories, setCategories] = useState<Category[]>([]);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [discountsEnabled, setDiscountsEnabled] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  async function load() {
    const { data, count } = await supabase
      .from("discount_rules")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);
    setRules((data as DiscountRule[]) ?? []);
    setTotalCount(count ?? 0);
  }

  async function loadMasterSwitch() {
    const { data } = await supabase.from("system_settings").select("value").eq("key", "discounts_enabled").maybeSingle();
    setDiscountsEnabled(data ? Boolean(data.value) : true);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  useEffect(() => {
    loadMasterSwitch();
    supabase.from("categories").select("id, name, slug").then(({ data }) => setCategories((data as Category[]) ?? []));
    supabase.from("merchants").select("id, business_name").eq("status", "active").then(({ data }) => setMerchants((data as Merchant[]) ?? []));
  }, []);

  async function toggleMasterSwitch() {
    const next = !discountsEnabled;
    setDiscountsEnabled(next);
    await supabase.from("system_settings").update({ value: next }).eq("key", "discounts_enabled");
  }

  async function toggleActive(r: DiscountRule) {
    const { error } = await supabase.from("discount_rules").update({ is_active: !r.is_active }).eq("id", r.id);
    if (error) return;
    setRules((prev) => prev.map((rule) => (rule.id === r.id ? { ...rule, is_active: !rule.is_active } : rule)));
  }

  async function bulkToggle(rows: DiscountRule[], makeActive: boolean) {
    const targets = rows.filter((r) => r.is_active !== makeActive);
    if (targets.length === 0) return;
    await supabase.from("discount_rules").update({ is_active: makeActive }).in("id", targets.map((r) => r.id));
    setRules((prev) => prev.map((r) => (targets.some((t) => t.id === r.id) ? { ...r, is_active: makeActive } : r)));
  }

  function labelFor(r: DiscountRule) {
    if (r.scope_type === "platform") return t("discounts.wholePlatform");
    if (r.scope_type === "category") return categories.find((c) => c.id === r.scope_id)?.name ?? r.scope_id;
    if (r.scope_type === "merchant") return merchants.find((m) => m.id === r.scope_id)?.business_name ?? r.scope_id;
    return r.scope_id;
  }

  // datetime-local inputs need "YYYY-MM-DDTHH:mm" in the browser's local
  // time, not the timestamptz ISO string Postgres returns — same conversion
  // needed either way, just applied when pre-filling an edit instead of only
  // when a user types a fresh value.
  function toDatetimeLocal(iso: string | null): string {
    if (!iso) return "";
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function startEdit(r: DiscountRule) {
    setEditingId(r.id);
    setForm({
      name: r.name,
      description: r.description ?? "",
      scope_type: r.scope_type === "product" ? "platform" : r.scope_type,
      scope_id: r.scope_id ?? "",
      code: r.code ?? "",
      discount_kind: r.discount_kind,
      amount: String(r.amount),
      max_discount_amount: r.max_discount_amount != null ? String(r.max_discount_amount) : "",
      min_order_value: String(r.min_order_value),
      funded_by: r.funded_by,
      tolo_share_percent: r.tolo_share_percent != null ? String(r.tolo_share_percent) : "50",
      usage_limit: r.usage_limit != null ? String(r.usage_limit) : "",
      per_customer_limit: r.per_customer_limit != null ? String(r.per_customer_limit) : "",
      first_order_only: r.first_order_only,
      starts_at: toDatetimeLocal(r.starts_at),
      ends_at: toDatetimeLocal(r.ends_at),
    });
    setShowForm(true);
  }

  function cancelForm() {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(false);
  }

  // Editing an existing rule only ever changes what future orders resolve —
  // resolve_best_discount() is read live at order-creation time and its
  // result is immediately snapshotted onto orders.discount_amount/
  // discount_rule_id and merchant_orders.discount_amount, plus a
  // discount_redemptions row. Past orders already carry their own snapshot
  // and are never recalculated from discount_rules again, so editing here
  // is safe by construction, not just by convention.
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error(t("discounts.nameRequired"));
      return;
    }
    if (form.scope_type !== "platform" && !form.scope_id) {
      toast.error(t("discounts.scopeRequired"));
      return;
    }
    setSaving(true);

    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      scope_type: form.scope_type,
      scope_id: form.scope_type === "platform" ? null : form.scope_id,
      code: form.code.trim() ? form.code.trim().toUpperCase() : null,
      discount_kind: form.discount_kind,
      amount: Number(form.amount),
      max_discount_amount: form.max_discount_amount ? Number(form.max_discount_amount) : null,
      min_order_value: Number(form.min_order_value) || 0,
      funded_by: form.funded_by,
      tolo_share_percent: form.funded_by === "shared" ? Number(form.tolo_share_percent) : null,
      usage_limit: form.usage_limit ? Number(form.usage_limit) : null,
      per_customer_limit: form.per_customer_limit ? Number(form.per_customer_limit) : null,
      first_order_only: form.first_order_only,
      starts_at: form.starts_at || null,
      ends_at: form.ends_at || null,
    };

    const { data, error } = editingId
      ? await supabase.from("discount_rules").update(payload).eq("id", editingId).select().single()
      : await supabase.from("discount_rules").insert(payload).select().single();

    setSaving(false);
    if (error) {
      toast.error(translateServerError(error.message, t));
      return;
    }
    if (editingId) {
      setRules((prev) => prev.map((r) => (r.id === editingId ? (data as DiscountRule) : r)));
    } else if (page === 1) {
      await load();
    } else {
      setPage(1);
    }
    cancelForm();
  }

  // Exports every discount rule, not just the page on screen.
  async function handleExport() {
    const rows = (await fetchAllRows((from, to) =>
      supabase.from("discount_rules").select("*").order("created_at", { ascending: false }).range(from, to),
    )) as DiscountRule[];
    exportToCsv(
      `discount-rules-${new Date().toISOString().slice(0, 10)}.csv`,
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        code: r.code ?? "",
        scope: labelFor(r),
        discount_kind: r.discount_kind,
        amount: r.amount,
        min_order_value: r.min_order_value,
        funded_by: r.funded_by,
        usage_count: r.usage_count,
        usage_limit: r.usage_limit ?? "",
        first_order_only: r.first_order_only,
        is_active: r.is_active,
        created_at: r.created_at,
      })),
    );
  }

  const columns: DataTableColumn<DiscountRule>[] = [
    {
      key: "name",
      header: t("discounts.ruleColumn"),
      render: (r) => (
        <div>
          <p className="text-sm font-medium">
            {r.name}
            {r.code && <span className="ml-2 text-xs font-mono bg-navy-50 dark:bg-navy-light/20 text-navy dark:text-navy-light px-1.5 py-0.5 rounded">{r.code}</span>}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {labelFor(r)} ·{" "}
            {r.discount_kind === "percent" ? t("promotions.percentOffLabel", { amount: r.amount }) : t("promotions.amountOffLabel", { amount: r.amount })}
            {r.min_order_value > 0 ? ` · ${t("discounts.minSuffix", { amount: r.min_order_value })}` : ""} ·{" "}
            {t("discounts.fundedBySuffix", { fundedBy: r.funded_by })} ·{" "}
            {r.usage_limit
              ? t("discounts.usedWithLimit", { count: r.usage_count, limit: r.usage_limit })
              : t("discounts.usedNoLimit", { count: r.usage_count })}
          </p>
        </div>
      ),
      filterValue: (r) => `${r.name} ${r.code ?? ""}`,
      sortValue: (r) => r.name,
      csvValue: (r) => r.name,
    },
    {
      key: "status",
      header: t("common.status"),
      render: (r) => <Badge variant={r.is_active ? "success" : "default"}>{r.is_active ? t("common.active") : t("common.inactive")}</Badge>,
      csvValue: (r) => (r.is_active ? "active" : "inactive"),
    },
    {
      key: "actions",
      header: "",
      render: (r) => (
        <div className="flex items-center gap-2 justify-end">
          <Button size="sm" variant="outline" onClick={() => startEdit(r)}>
            {t("common.edit")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => toggleActive(r)}>
            {r.is_active ? t("banners.deactivate") : t("banners.activate")}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold dark:text-gray-100">{t("discounts.title")}</h1>
        <label className="flex items-center gap-2 text-sm bg-white dark:bg-navy-dark border dark:border-white/10 rounded-lg px-3 py-2">
          <span className="font-medium dark:text-gray-200">{t("discounts.platformWide")}</span>
          <button
            type="button"
            onClick={toggleMasterSwitch}
            className={`w-10 h-6 rounded-full transition-colors relative ${discountsEnabled ? "bg-navy dark:bg-navy-light" : "bg-gray-300 dark:bg-white/20"}`}
          >
            <span
              className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${discountsEnabled ? "translate-x-4" : "translate-x-0.5"}`}
            />
          </button>
          <span className="text-xs text-gray-500 dark:text-gray-400">{discountsEnabled ? t("discounts.on") : t("discounts.off")}</span>
        </label>
      </div>

      {!discountsEnabled && (
        <p className="text-xs bg-orange-50 dark:bg-orange-950/40 border border-orange-200 dark:border-orange-800 text-orange-800 dark:text-orange-300 rounded-md px-3 py-2 mb-4">
          {t("discounts.disabledNotice")}
        </p>
      )}

      <button
        onClick={() => (showForm ? cancelForm() : setShowForm(true))}
        className="bg-navy dark:bg-navy-light text-white text-sm px-4 py-2 rounded-md hover:bg-navy-dark dark:hover:bg-navy mb-4"
      >
        {showForm ? t("common.cancel") : t("discounts.newRule")}
      </button>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white dark:bg-navy-dark border dark:border-white/10 rounded-lg p-4 mb-4 space-y-3">
          <input
            placeholder={t("discounts.namePlaceholder")}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full border rounded-md px-3 py-2 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
          />
          <input
            placeholder={t("discounts.descriptionPlaceholder")}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full border rounded-md px-3 py-2 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
          />
          <div>
            <input
              placeholder={t("discounts.promoCodePlaceholder")}
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              className="w-full border rounded-md px-3 py-2 text-sm uppercase placeholder:normal-case dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
            />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              {form.code.trim() ? t("discounts.codeAppliesNote") : t("discounts.noCodeNote")}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t("promotions.appliesTo")}</label>
              <select
                value={form.scope_type}
                onChange={(e) => setForm({ ...form, scope_type: e.target.value as DiscountRule["scope_type"], scope_id: "" })}
                className="w-full border rounded-md px-2 py-1.5 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
              >
                <option value="platform">{t("discounts.wholePlatform")}</option>
                <option value="merchant">{t("discounts.specificMerchant")}</option>
                <option value="category">{t("discounts.specificCategory")}</option>
              </select>
            </div>
            {form.scope_type !== "platform" && (
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">
                  {form.scope_type === "merchant" ? t("discounts.appliesToMerchant") : t("discounts.appliesToCategory")}
                </label>
                <select
                  value={form.scope_id}
                  onChange={(e) => setForm({ ...form, scope_id: e.target.value })}
                  className="w-full border rounded-md px-2 py-1.5 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
                >
                  <option value="">{t("commissions.selectEllipsis")}</option>
                  {(form.scope_type === "merchant" ? merchants : categories).map((item) => (
                    <option key={item.id} value={item.id}>
                      {"business_name" in item ? item.business_name : item.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t("discounts.type")}</label>
              <select
                value={form.discount_kind}
                onChange={(e) => setForm({ ...form, discount_kind: e.target.value as DiscountRule["discount_kind"] })}
                className="w-full border rounded-md px-2 py-1.5 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
              >
                <option value="percent">{t("discounts.percentOff")}</option>
                <option value="fixed">{t("discounts.fixedEtbAmount")}</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">
                {form.discount_kind === "percent" ? t("discounts.percent") : t("discounts.amountEtb")}
              </label>
              <input
                type="number"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                className="w-full border rounded-md px-2 py-1.5 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
              />
            </div>
            {form.discount_kind === "percent" && (
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t("discounts.maxDiscountOptional")}</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.max_discount_amount}
                  onChange={(e) => setForm({ ...form, max_discount_amount: e.target.value })}
                  className="w-full border rounded-md px-2 py-1.5 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t("discounts.minOrderValue")}</label>
              <input
                type="number"
                step="0.01"
                value={form.min_order_value}
                onChange={(e) => setForm({ ...form, min_order_value: e.target.value })}
                className="w-full border rounded-md px-2 py-1.5 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t("discounts.totalUsageLimit")}</label>
              <input
                type="number"
                value={form.usage_limit}
                onChange={(e) => setForm({ ...form, usage_limit: e.target.value })}
                className="w-full border rounded-md px-2 py-1.5 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t("discounts.perCustomerLimit")}</label>
              <input
                type="number"
                value={form.per_customer_limit}
                onChange={(e) => setForm({ ...form, per_customer_limit: e.target.value })}
                className="w-full border rounded-md px-2 py-1.5 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t("promotions.starts")}</label>
              <input
                type="datetime-local"
                value={form.starts_at}
                onChange={(e) => setForm({ ...form, starts_at: e.target.value })}
                className="w-full border rounded-md px-2 py-1.5 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t("promotions.ends")}</label>
              <input
                type="datetime-local"
                value={form.ends_at}
                onChange={(e) => setForm({ ...form, ends_at: e.target.value })}
                className="w-full border rounded-md px-2 py-1.5 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm dark:text-gray-200">
            <input
              type="checkbox"
              checked={form.first_order_only}
              onChange={(e) => setForm({ ...form, first_order_only: e.target.checked })}
            />
            {t("discounts.firstOrderOnly")}
          </label>

          <div className="pt-2 border-t dark:border-white/10">
            <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t("discounts.whoFunds")}</label>
            <div className="grid grid-cols-3 gap-2">
              <select
                value={form.funded_by}
                onChange={(e) => setForm({ ...form, funded_by: e.target.value as DiscountRule["funded_by"] })}
                className="w-full border rounded-md px-2 py-1.5 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
              >
                <option value="tolo">{t("discounts.toloAbsorbs")}</option>
                <option value="merchant">{t("discounts.merchantAbsorbs")}</option>
                <option value="shared">{t("discounts.shared")}</option>
              </select>
              {form.funded_by === "shared" && (
                <input
                  type="number"
                  placeholder={t("discounts.toloSharePercent")}
                  value={form.tolo_share_percent}
                  onChange={(e) => setForm({ ...form, tolo_share_percent: e.target.value })}
                  className="w-full border rounded-md px-2 py-1.5 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
                />
              )}
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="bg-navy dark:bg-navy-light text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-navy-dark dark:hover:bg-navy disabled:opacity-60"
          >
            {saving ? t("discounts.saving") : editingId ? t("discounts.saveChanges") : t("discounts.createDiscount")}
          </button>
        </form>
      )}

      <DataTable
        storageKey="admin.discounts"
        columns={columns}
        rows={rules}
        getRowId={(r) => r.id}
        emptyMessage={t("discounts.noRulesYet")}
        onExportAll={handleExport}
        bulkActions={[
          { label: t("banners.activate"), onAction: (rows) => bulkToggle(rows, true) },
          { label: t("banners.deactivate"), onAction: (rows) => bulkToggle(rows, false), variant: "outline" },
        ]}
      />
      <div className="mt-4">
        <Pagination page={page} totalPages={totalPagesFor(totalCount, ADMIN_PAGE_SIZE)} onPageChange={setPage} />
      </div>
    </div>
  );
}
