import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Category, CommissionRule, Merchant } from "../types";

export function Commissions() {
  const [rules, setRules] = useState<CommissionRule[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [merchants, setMerchants] = useState<Merchant[]>([]);

  const [scopeType, setScopeType] = useState("platform");
  const [scopeId, setScopeId] = useState("");
  const [rate, setRate] = useState("5");
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase.from("commission_rules").select("*").order("scope_type");
    setRules(data ?? []);
  }

  useEffect(() => {
    load();
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
    setError(null);
    const payload = {
      scope_type: scopeType,
      scope_id: scopeType === "platform" ? null : scopeId || null,
      rate_percent: Number(rate),
    };
    const { data, error } = editingId
      ? await supabase.from("commission_rules").update(payload).eq("id", editingId).select().single()
      : await supabase.from("commission_rules").insert(payload).select().single();
    if (error) {
      setError(error.message);
      return;
    }
    setRules((prev) => (editingId ? prev.map((r) => (r.id === editingId ? data : r)) : [...prev, data]));
    resetForm();
  }

  function startEdit(r: CommissionRule) {
    setEditingId(r.id);
    setScopeType(r.scope_type);
    setScopeId(r.scope_id ?? "");
    setRate(String(r.rate_percent));
    setError(null);
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

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-bold mb-4">Commission Rules</h1>

      <form onSubmit={handleSubmit} className="bg-white border rounded-lg p-4 mb-4 flex gap-2 items-end flex-wrap">
        <div>
          <label className="text-xs text-gray-500 block mb-1">Scope</label>
          <select value={scopeType} onChange={(e) => setScopeType(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm">
            <option value="platform">Platform</option>
            <option value="category">Category</option>
            <option value="merchant">Merchant</option>
          </select>
        </div>
        {scopeType !== "platform" && (
          <div>
            <label className="text-xs text-gray-500 block mb-1">{scopeType === "category" ? "Category" : "Merchant"}</label>
            <select value={scopeId} onChange={(e) => setScopeId(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm">
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
          <label className="text-xs text-gray-500 block mb-1">Rate (%)</label>
          <input
            type="number"
            step="0.1"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            className="border rounded-md px-2 py-1.5 text-sm w-24"
          />
        </div>
        <button type="submit" className="bg-navy text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-navy-dark">
          {editingId ? "Save changes" : "Add rule"}
        </button>
        {editingId && (
          <button type="button" onClick={resetForm} className="text-sm text-gray-500 px-2 py-2">
            Cancel
          </button>
        )}
      </form>
      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      <div className="bg-white border rounded-lg divide-y">
        {rules.map((r) => (
          <div key={r.id} className="flex items-center justify-between p-3">
            <div>
              <span className="text-xs uppercase text-gray-400 mr-2">{r.scope_type}</span>
              <span className="text-sm">{labelFor(r)}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-semibold text-sm">{r.rate_percent}%</span>
              <button onClick={() => startEdit(r)} className="text-xs border px-2 py-1 rounded-md hover:bg-gray-50">
                Edit
              </button>
              <button
                onClick={() => toggleActive(r)}
                className={`text-xs px-2 py-1 rounded-full border ${
                  r.is_active ? "bg-emerald-100 text-emerald-800 border-emerald-200" : "bg-gray-100 text-gray-600"
                }`}
              >
                {r.is_active ? "Active" : "Inactive"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
