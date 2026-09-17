import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { exportToCsv } from "../lib/csvExport";
import type { Category, DiscountRule, Merchant } from "../types";

const emptyForm = {
  name: "",
  description: "",
  scope_type: "platform" as DiscountRule["scope_type"],
  scope_id: "",
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
  const [rules, setRules] = useState<DiscountRule[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [discountsEnabled, setDiscountsEnabled] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);

  async function load() {
    const { data } = await supabase.from("discount_rules").select("*").order("created_at", { ascending: false });
    setRules((data as DiscountRule[]) ?? []);
  }

  async function loadMasterSwitch() {
    const { data } = await supabase.from("system_settings").select("value").eq("key", "discounts_enabled").maybeSingle();
    setDiscountsEnabled(data ? Boolean(data.value) : true);
  }

  useEffect(() => {
    load();
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
    await supabase.from("discount_rules").update({ is_active: !r.is_active }).eq("id", r.id);
    await load();
  }

  function labelFor(r: DiscountRule) {
    if (r.scope_type === "platform") return "Whole platform";
    if (r.scope_type === "category") return categories.find((c) => c.id === r.scope_id)?.name ?? r.scope_id;
    if (r.scope_type === "merchant") return merchants.find((m) => m.id === r.scope_id)?.business_name ?? r.scope_id;
    return r.scope_id;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.name.trim()) {
      setError("Name is required.");
      return;
    }
    if (form.scope_type !== "platform" && !form.scope_id) {
      setError("Select a merchant or category for this scope.");
      return;
    }
    setSaving(true);

    const { error } = await supabase.from("discount_rules").insert({
      name: form.name.trim(),
      description: form.description.trim() || null,
      scope_type: form.scope_type,
      scope_id: form.scope_type === "platform" ? null : form.scope_id,
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
    });

    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setForm(emptyForm);
    setShowForm(false);
    await load();
  }

  function handleExport() {
    exportToCsv(
      `discount-rules-${new Date().toISOString().slice(0, 10)}.csv`,
      rules.map((r) => ({
        id: r.id,
        name: r.name,
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

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">Discounts &amp; Promotions</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            disabled={rules.length === 0}
            className="text-xs border px-3 py-1.5 rounded-md hover:bg-gray-50 disabled:opacity-40"
          >
            ⬇ Export CSV
          </button>
        <label className="flex items-center gap-2 text-sm bg-white border rounded-lg px-3 py-2">
          <span className="font-medium">Discounts platform-wide</span>
          <button
            type="button"
            onClick={toggleMasterSwitch}
            className={`w-10 h-6 rounded-full transition-colors relative ${discountsEnabled ? "bg-navy" : "bg-gray-300"}`}
          >
            <span
              className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${discountsEnabled ? "translate-x-4" : "translate-x-0.5"}`}
            />
          </button>
          <span className="text-xs text-gray-500">{discountsEnabled ? "ON" : "OFF"}</span>
        </label>
        </div>
      </div>

      {!discountsEnabled && (
        <p className="text-xs bg-orange-50 border border-orange-200 text-orange-800 rounded-md px-3 py-2 mb-4">
          Discounts are turned off platform-wide — no rule below will apply at checkout until this is switched back on.
        </p>
      )}

      <button
        onClick={() => setShowForm((s) => !s)}
        className="bg-navy text-white text-sm px-4 py-2 rounded-md hover:bg-navy-dark mb-4"
      >
        {showForm ? "Cancel" : "+ New discount rule"}
      </button>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white border rounded-lg p-4 mb-4 space-y-3">
          <input
            placeholder="Name (e.g. First Order 10% Off)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full border rounded-md px-3 py-2 text-sm"
          />
          <input
            placeholder="Description (optional)"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full border rounded-md px-3 py-2 text-sm"
          />

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Applies to</label>
              <select
                value={form.scope_type}
                onChange={(e) => setForm({ ...form, scope_type: e.target.value as DiscountRule["scope_type"], scope_id: "" })}
                className="w-full border rounded-md px-2 py-1.5 text-sm"
              >
                <option value="platform">Whole platform</option>
                <option value="merchant">Specific merchant</option>
                <option value="category">Specific category</option>
              </select>
            </div>
            {form.scope_type !== "platform" && (
              <div>
                <label className="text-xs text-gray-500 block mb-1">{form.scope_type === "merchant" ? "Merchant" : "Category"}</label>
                <select
                  value={form.scope_id}
                  onChange={(e) => setForm({ ...form, scope_id: e.target.value })}
                  className="w-full border rounded-md px-2 py-1.5 text-sm"
                >
                  <option value="">Select...</option>
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
              <label className="text-xs text-gray-500 block mb-1">Type</label>
              <select
                value={form.discount_kind}
                onChange={(e) => setForm({ ...form, discount_kind: e.target.value as DiscountRule["discount_kind"] })}
                className="w-full border rounded-md px-2 py-1.5 text-sm"
              >
                <option value="percent">Percent off</option>
                <option value="fixed">Fixed ETB amount</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">{form.discount_kind === "percent" ? "Percent" : "Amount (ETB)"}</label>
              <input
                type="number"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                className="w-full border rounded-md px-2 py-1.5 text-sm"
              />
            </div>
            {form.discount_kind === "percent" && (
              <div>
                <label className="text-xs text-gray-500 block mb-1">Max discount (ETB, optional)</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.max_discount_amount}
                  onChange={(e) => setForm({ ...form, max_discount_amount: e.target.value })}
                  className="w-full border rounded-md px-2 py-1.5 text-sm"
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Min order value (ETB)</label>
              <input
                type="number"
                step="0.01"
                value={form.min_order_value}
                onChange={(e) => setForm({ ...form, min_order_value: e.target.value })}
                className="w-full border rounded-md px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Total usage limit (optional)</label>
              <input
                type="number"
                value={form.usage_limit}
                onChange={(e) => setForm({ ...form, usage_limit: e.target.value })}
                className="w-full border rounded-md px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Per-customer limit (optional)</label>
              <input
                type="number"
                value={form.per_customer_limit}
                onChange={(e) => setForm({ ...form, per_customer_limit: e.target.value })}
                className="w-full border rounded-md px-2 py-1.5 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Starts (optional)</label>
              <input
                type="datetime-local"
                value={form.starts_at}
                onChange={(e) => setForm({ ...form, starts_at: e.target.value })}
                className="w-full border rounded-md px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Ends (optional)</label>
              <input
                type="datetime-local"
                value={form.ends_at}
                onChange={(e) => setForm({ ...form, ends_at: e.target.value })}
                className="w-full border rounded-md px-2 py-1.5 text-sm"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.first_order_only}
              onChange={(e) => setForm({ ...form, first_order_only: e.target.checked })}
            />
            First order only
          </label>

          <div className="pt-2 border-t">
            <label className="text-xs text-gray-500 block mb-1">Who funds this discount?</label>
            <div className="grid grid-cols-3 gap-2">
              <select
                value={form.funded_by}
                onChange={(e) => setForm({ ...form, funded_by: e.target.value as DiscountRule["funded_by"] })}
                className="w-full border rounded-md px-2 py-1.5 text-sm"
              >
                <option value="tolo">Tolo absorbs it</option>
                <option value="merchant">Merchant absorbs it</option>
                <option value="shared">Shared</option>
              </select>
              {form.funded_by === "shared" && (
                <input
                  type="number"
                  placeholder="Tolo's share %"
                  value={form.tolo_share_percent}
                  onChange={(e) => setForm({ ...form, tolo_share_percent: e.target.value })}
                  className="w-full border rounded-md px-2 py-1.5 text-sm"
                />
              )}
            </div>
          </div>

          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={saving}
            className="bg-navy text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-navy-dark disabled:opacity-60"
          >
            {saving ? "Creating..." : "Create discount"}
          </button>
        </form>
      )}

      <div className="bg-white border rounded-lg divide-y">
        {rules.length === 0 ? (
          <p className="text-gray-500 text-sm p-4">No discount rules yet.</p>
        ) : (
          rules.map((r) => (
            <div key={r.id} className="p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{r.name}</p>
                  <p className="text-xs text-gray-500">
                    {labelFor(r)} · {r.discount_kind === "percent" ? `${r.amount}% off` : `${r.amount} ETB off`}
                    {r.min_order_value > 0 ? ` · min ${r.min_order_value} ETB` : ""} · funded by {r.funded_by}
                    {r.usage_limit ? ` · used ${r.usage_count}/${r.usage_limit}` : ` · used ${r.usage_count}`}
                  </p>
                </div>
                <button
                  onClick={() => toggleActive(r)}
                  className={`text-xs px-2 py-1 rounded-full border flex-shrink-0 ${
                    r.is_active ? "bg-emerald-100 text-emerald-800 border-emerald-200" : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {r.is_active ? "Active" : "Inactive"}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
