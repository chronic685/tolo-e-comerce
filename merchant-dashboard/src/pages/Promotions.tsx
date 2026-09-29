import { useEffect, useState } from "react";
import { Tag } from "lucide-react";
import { ADMIN_PAGE_SIZE, EmptyState, Pagination, SkeletonRows, toast, totalPagesFor, usePagination } from "@tolo/ui";
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
      toast.error("Name and amount are required.");
      return;
    }
    if (form.scope === "product" && !form.product_id) {
      toast.error("Choose which product this promotion applies to.");
      return;
    }
    if (form.discount_kind === "percent" && Number(form.amount) > 100) {
      toast.error("A percentage discount can't be more than 100%.");
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
      toast.error(error.message);
      return;
    }
    toast.success("Saved.");
    setShowForm(false);
    load();
  }

  async function toggleActive(p: Promotion) {
    const { error } = await supabase.from("discount_rules").update({ is_active: !p.is_active }).eq("id", p.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setPromotions((prev) => prev.map((x) => (x.id === p.id ? { ...x, is_active: !x.is_active } : x)));
  }

  async function handleDelete(p: Promotion) {
    if (!confirm(`Delete "${p.name}"? This can't be undone.`)) return;
    const { error } = await supabase.from("discount_rules").delete().eq("id", p.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Deleted.");
    load();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">Promotions</h1>
        <button onClick={startNew} className="text-sm bg-navy text-white px-3 py-1.5 rounded-md hover:bg-navy-dark">
          + New promotion
        </button>
      </div>

      {showForm && (
        <div className="bg-white border rounded-lg p-4 mb-4 space-y-3">
          <h2 className="font-medium text-sm">{editingId ? "Edit promotion" : "New promotion"}</h2>
          <input
            placeholder="Name (e.g. Weekend 10% off)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full border rounded-md px-3 py-2 text-sm"
          />
          <textarea
            placeholder="Description (optional)"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={2}
            className="w-full border rounded-md px-3 py-2 text-sm"
          />
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">Applies to</label>
            <div className="flex gap-3 text-sm mb-2">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={form.scope === "shop"} onChange={() => setForm({ ...form, scope: "shop" })} />
                My whole shop
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={form.scope === "product"} onChange={() => setForm({ ...form, scope: "product" })} />
                One product
              </label>
            </div>
            {form.scope === "product" && (
              <select
                value={form.product_id}
                onChange={(e) => setForm({ ...form, product_id: e.target.value })}
                className="w-full border rounded-md px-3 py-2 text-sm"
              >
                <option value="">Select a product</option>
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
              <label className="text-xs font-medium text-gray-500 block mb-1">Discount type</label>
              <select
                value={form.discount_kind}
                onChange={(e) => setForm({ ...form, discount_kind: e.target.value as Promotion["discount_kind"] })}
                className="w-full border rounded-md px-3 py-2 text-sm"
              >
                <option value="percent">Percentage off</option>
                <option value="fixed">Fixed amount off (ETB)</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Amount</label>
              <input
                type="number"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                className="w-full border rounded-md px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Starts (optional)</label>
              <input
                type="datetime-local"
                value={form.starts_at}
                onChange={(e) => setForm({ ...form, starts_at: e.target.value })}
                className="w-full border rounded-md px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Ends (optional)</label>
              <input
                type="datetime-local"
                value={form.ends_at}
                onChange={(e) => setForm({ ...form, ends_at: e.target.value })}
                className="w-full border rounded-md px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-navy text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-navy-dark disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save"}
            </button>
            <button onClick={() => setShowForm(false)} className="border px-4 py-2 rounded-md text-sm hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <SkeletonRows />
      ) : promotions.length === 0 ? (
        <EmptyState icon={Tag} title="No promotions yet" description="Create a promotion to offer a discount on your shop or a product." />
      ) : (
        <>
          <div className="bg-white border rounded-lg divide-y">
            {promotions.map((p) => (
              <div key={p.id} className="p-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">
                    {p.name}{" "}
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${p.is_active ? "bg-emerald-100 text-emerald-800" : "bg-gray-100 text-gray-600"}`}>
                      {p.is_active ? "Active" : "Paused"}
                    </span>
                  </p>
                  <p className="text-xs text-gray-500">
                    {p.discount_kind === "percent" ? `${p.amount}% off` : `${p.amount} ETB off`} ·{" "}
                    {p.scope_type === "merchant" ? "Whole shop" : "One product"}
                    {p.starts_at && ` · from ${new Date(p.starts_at).toLocaleDateString()}`}
                    {p.ends_at && ` · until ${new Date(p.ends_at).toLocaleDateString()}`}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => toggleActive(p)} className="text-xs border px-2 py-1 rounded-md hover:bg-gray-50">
                    {p.is_active ? "Pause" : "Activate"}
                  </button>
                  <button onClick={() => startEdit(p)} className="text-xs border px-2 py-1 rounded-md hover:bg-gray-50">
                    Edit
                  </button>
                  <button onClick={() => handleDelete(p)} className="text-xs text-red-600 border border-red-200 px-2 py-1 rounded-md hover:bg-red-50">
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4">
            <Pagination page={page} totalPages={totalPagesFor(totalCount, ADMIN_PAGE_SIZE)} onPageChange={setPage} />
          </div>
        </>
      )}
    </div>
  );
}
