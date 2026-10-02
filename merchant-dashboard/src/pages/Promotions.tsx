import { useEffect, useState } from "react";
import { Tag } from "lucide-react";
import {
  ADMIN_PAGE_SIZE,
  Badge,
  Button,
  DataTable,
  EmptyState,
  Pagination,
  SkeletonRows,
  toast,
  totalPagesFor,
  usePagination,
  useTranslation,
  type DataTableColumn,
} from "@tolo/ui";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { useMerchant } from "../lib/MerchantContext";
import type { Promotion } from "../types";

interface ProductOption {
  id: string;
  name: string;
}

const emptyForm = {
  name: "",
  description: "",
  scope: "shop" as "shop" | "product",
  product_id: "",
  discount_kind: "percent" as Promotion["discount_kind"],
  amount: "10",
  starts_at: "",
  ends_at: "",
};

// Group 3, item 10. Deliberately narrow: percent/fixed, a date range, and
// scope of "my whole shop" or "one of my products" -- exactly what was
// asked. funded_by is always 'merchant' and scope_type is always
// 'merchant'/'product' -- discount_rules_manage RLS (migration 0062)
// enforces both server-side regardless of what this form sends.
export function Promotions() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { merchant } = useMerchant();
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const { page, from, to, setPage } = usePagination({ pageSize: ADMIN_PAGE_SIZE });

  // Own products must be known first -- the scope filter below needs their
  // ids to tell "one of MY products" apart from another merchant's
  // product-scoped promotion (discount_rules_select's RLS is broad --
  // "readable by everyone except another customer's personal reward",
  // migration 0026 -- so an unscoped query would otherwise return every
  // merchant's product promotions, not just this shop's).
  useEffect(() => {
    if (!merchant) return;
    supabase
      .from("products")
      .select("id, name")
      .eq("merchant_id", merchant.id)
      .order("name")
      .then(({ data }) => setProducts(data ?? []));
  }, [merchant]);

  async function load() {
    if (!merchant) return;
    setLoading(true);
    const productIds = products.map((p) => p.id);
    const scopeFilter =
      productIds.length > 0
        ? `and(scope_type.eq.merchant,scope_id.eq.${merchant.id}),and(scope_type.eq.product,scope_id.in.(${productIds.join(",")}))`
        : `and(scope_type.eq.merchant,scope_id.eq.${merchant.id})`;
    const { data, count } = await supabase
      .from("discount_rules")
      .select("id, name, description, scope_type, scope_id, discount_kind, amount, starts_at, ends_at, is_active, created_at", {
        count: "exact",
      })
      .eq("funded_by", "merchant")
      .or(scopeFilter)
      .order("created_at", { ascending: false })
      .range(from, to);
    setPromotions((data as Promotion[]) ?? []);
    setTotalCount(count ?? 0);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchant, products, from, to]);

  function startEdit(p: Promotion) {
    setEditingId(p.id);
    setForm({
      name: p.name,
      description: p.description ?? "",
      scope: p.scope_type === "product" ? "product" : "shop",
      product_id: p.scope_type === "product" ? (p.scope_id ?? "") : "",
      discount_kind: p.discount_kind,
      amount: String(p.amount),
      starts_at: p.starts_at ? p.starts_at.slice(0, 16) : "",
      ends_at: p.ends_at ? p.ends_at.slice(0, 16) : "",
    });
    setShowForm(true);
  }

  function startNew() {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  }

  async function handleSave() {
    if (!merchant || !user) return;
    if (!form.name.trim() || !form.amount.trim()) {
      toast.error(t("promotions.nameAmountRequired"));
      return;
    }
    if (form.scope === "product" && !form.product_id) {
      toast.error(t("promotions.chooseProduct"));
      return;
    }
    if (form.discount_kind === "percent" && Number(form.amount) > 100) {
      toast.error(t("promotions.percentTooHigh"));
      return;
    }

    setSaving(true);
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      scope_type: form.scope === "shop" ? "merchant" : "product",
      scope_id: form.scope === "shop" ? merchant.id : form.product_id,
      discount_kind: form.discount_kind,
      amount: Number(form.amount),
      funded_by: "merchant",
      starts_at: form.starts_at ? new Date(form.starts_at).toISOString() : null,
      ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
      is_active: true,
      created_by: user.id,
    };

    const { error } = editingId
      ? await supabase.from("discount_rules").update(payload).eq("id", editingId)
      : await supabase.from("discount_rules").insert(payload);

    setSaving(false);
    if (error) {
      toast.error(t("promotions.saveError"));
      return;
    }
    toast.success(t("promotions.saved"));
    setShowForm(false);
    load();
  }

  async function toggleActive(p: Promotion) {
    const { error } = await supabase.from("discount_rules").update({ is_active: !p.is_active }).eq("id", p.id);
    if (error) {
      toast.error(t("promotions.saveError"));
      return;
    }
    setPromotions((prev) => prev.map((x) => (x.id === p.id ? { ...x, is_active: !x.is_active } : x)));
  }

  async function handleDelete(p: Promotion) {
    if (!confirm(t("promotions.deleteConfirm", { name: p.name }))) return;
    const { error } = await supabase.from("discount_rules").delete().eq("id", p.id);
    if (error) {
      toast.error(t("promotions.saveError"));
      return;
    }
    toast.success(t("promotions.deleted"));
    load();
  }

  async function bulkPause(rows: Promotion[]) {
    const active = rows.filter((p) => p.is_active);
    if (active.length === 0) return;
    await supabase.from("discount_rules").update({ is_active: false }).in("id", active.map((p) => p.id));
    setPromotions((prev) => prev.map((p) => (active.some((a) => a.id === p.id) ? { ...p, is_active: false } : p)));
  }

  function describe(p: Promotion): string {
    return (
      (p.discount_kind === "percent" ? t("promotions.percentOffLabel", { amount: p.amount }) : t("promotions.amountOffLabel", { amount: p.amount })) +
      " · " +
      (p.scope_type === "merchant" ? t("promotions.wholeShop") : t("promotions.oneProduct")) +
      (p.starts_at ? ` ${t("promotions.fromDate", { date: new Date(p.starts_at).toLocaleDateString() })}` : "") +
      (p.ends_at ? ` ${t("promotions.untilDate", { date: new Date(p.ends_at).toLocaleDateString() })}` : "")
    );
  }

  const columns: DataTableColumn<Promotion>[] = [
    {
      key: "name",
      header: t("promotions.column"),
      render: (p) => (
        <div>
          <p className="text-sm font-medium">{p.name}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">{describe(p)}</p>
        </div>
      ),
      filterValue: (p) => p.name,
      sortValue: (p) => p.name,
      csvValue: (p) => p.name,
    },
    {
      key: "status",
      header: t("common.status"),
      render: (p) => <Badge variant={p.is_active ? "success" : "default"}>{p.is_active ? t("promotions.active") : t("promotions.paused")}</Badge>,
      csvValue: (p) => (p.is_active ? "active" : "paused"),
    },
    {
      key: "actions",
      header: "",
      render: (p) => (
        <div className="flex items-center gap-2 justify-end">
          <Button size="sm" variant="outline" onClick={() => toggleActive(p)}>
            {p.is_active ? t("promotions.pause") : t("promotions.activate")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => startEdit(p)}>
            {t("common.edit")}
          </Button>
          <Button size="sm" variant="destructive" onClick={() => handleDelete(p)}>
            {t("common.delete")}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold dark:text-gray-100">{t("promotions.title")}</h1>
        <button onClick={startNew} className="text-sm bg-navy dark:bg-navy-light text-white px-3 py-1.5 rounded-md hover:bg-navy-dark dark:hover:bg-navy">
          {t("promotions.newPromotion")}
        </button>
      </div>

      {showForm && (
        <div className="bg-white dark:bg-navy-dark border dark:border-white/10 rounded-lg p-4 mb-4 space-y-3">
          <h2 className="font-medium text-sm dark:text-gray-100">{editingId ? t("promotions.editPromotionTitle") : t("promotions.newPromotionTitle")}</h2>
          <input
            placeholder={t("promotions.namePlaceholder")}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full border rounded-md px-3 py-2 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
          />
          <textarea
            placeholder={`${t("common.description")} (${t("common.optional")})`}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={2}
            className="w-full border rounded-md px-3 py-2 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
          />
          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">{t("promotions.appliesTo")}</label>
            <div className="flex gap-3 text-sm mb-2 dark:text-gray-200">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={form.scope === "shop"} onChange={() => setForm({ ...form, scope: "shop" })} />
                {t("promotions.myWholeShop")}
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={form.scope === "product"} onChange={() => setForm({ ...form, scope: "product" })} />
                {t("promotions.oneProduct")}
              </label>
            </div>
            {form.scope === "product" && (
              <select
                value={form.product_id}
                onChange={(e) => setForm({ ...form, product_id: e.target.value })}
                className="w-full border rounded-md px-3 py-2 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
              >
                <option value="">{t("promotions.selectProduct")}</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">{t("promotions.discountType")}</label>
              <select
                value={form.discount_kind}
                onChange={(e) => setForm({ ...form, discount_kind: e.target.value as Promotion["discount_kind"] })}
                className="w-full border rounded-md px-3 py-2 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
              >
                <option value="percent">{t("promotions.percentageOff")}</option>
                <option value="fixed">{t("promotions.fixedAmountOff")}</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">{t("common.amount")}</label>
              <input
                type="number"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                className="w-full border rounded-md px-3 py-2 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">{t("promotions.starts")}</label>
              <input
                type="datetime-local"
                value={form.starts_at}
                onChange={(e) => setForm({ ...form, starts_at: e.target.value })}
                className="w-full border rounded-md px-3 py-2 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">{t("promotions.ends")}</label>
              <input
                type="datetime-local"
                value={form.ends_at}
                onChange={(e) => setForm({ ...form, ends_at: e.target.value })}
                className="w-full border rounded-md px-3 py-2 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-navy dark:bg-navy-light text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-navy-dark dark:hover:bg-navy disabled:opacity-60"
            >
              {saving ? t("common.saving") : t("common.save")}
            </button>
            <button onClick={() => setShowForm(false)} className="border dark:border-white/20 dark:text-gray-200 px-4 py-2 rounded-md text-sm hover:bg-gray-50 dark:hover:bg-white/5">
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <SkeletonRows />
      ) : promotions.length === 0 ? (
        <EmptyState icon={Tag} title={t("promotions.noPromotionsTitle")} description={t("promotions.noPromotionsDescription")} />
      ) : (
        <>
          <DataTable
            storageKey="merchant.promotions"
            columns={columns}
            rows={promotions}
            getRowId={(p) => p.id}
            bulkActions={[{ label: t("promotions.pause"), onAction: bulkPause }]}
          />
          <div className="mt-4">
            <Pagination page={page} totalPages={totalPagesFor(totalCount, ADMIN_PAGE_SIZE)} onPageChange={setPage} />
          </div>
        </>
      )}
    </div>
  );
}
