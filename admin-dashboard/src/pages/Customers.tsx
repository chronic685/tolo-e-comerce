import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { exportToCsv } from "../lib/csvExport";
import type { CustomerProfile } from "../types";

export function Customers() {
  const [customers, setCustomers] = useState<CustomerProfile[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [orderCounts, setOrderCounts] = useState<Record<string, number>>({});

  async function load() {
    setLoading(true);
    let query = supabase
      .from("profiles")
      .select("id, full_name, phone, account_status, created_at")
      .eq("role", "customer")
      .order("created_at", { ascending: false })
      .limit(100);
    if (search.trim()) query = query.or(`full_name.ilike.%${search.trim()}%,phone.ilike.%${search.trim()}%`);
    const { data } = await query;
    const rows = (data as CustomerProfile[]) ?? [];
    setCustomers(rows);
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
  }, []);

  async function toggleStatus(c: CustomerProfile) {
    const next = c.account_status === "active" ? "suspended" : "active";
    await supabase.from("profiles").update({ account_status: next }).eq("id", c.id);
    await load();
  }

  function handleExport() {
    exportToCsv(
      `customers-${new Date().toISOString().slice(0, 10)}.csv`,
      customers.map((c) => ({
        id: c.id,
        full_name: c.full_name ?? "",
        phone: c.phone ?? "",
        account_status: c.account_status,
        order_count: orderCounts[c.id] ?? 0,
        registered_at: c.created_at,
      })),
    );
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">Customers</h1>
        <button
          onClick={handleExport}
          disabled={customers.length === 0}
          className="text-xs border px-3 py-1.5 rounded-md hover:bg-gray-50 disabled:opacity-40"
        >
          ⬇ Export CSV
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        <input
          placeholder="Search by name or phone"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
          className="flex-1 border rounded-md px-3 py-2 text-sm"
        />
        <button onClick={load} className="bg-navy text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-navy-dark">
          Search
        </button>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : customers.length === 0 ? (
        <p className="text-gray-500">No customers found.</p>
      ) : (
        <div className="bg-white border rounded-lg divide-y">
          {customers.map((c) => (
            <div key={c.id} className="p-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{c.full_name ?? "Unnamed"}</p>
                <p className="text-xs text-gray-500">
                  {c.phone ?? "—"} · {orderCounts[c.id] ?? 0} order(s) · joined {new Date(c.created_at).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span
                  className={`text-xs px-2 py-0.5 rounded-full capitalize ${
                    c.account_status === "active" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
                  }`}
                >
                  {c.account_status}
                </span>
                <button
                  onClick={() => toggleStatus(c)}
                  className={`text-xs px-2 py-1.5 rounded-md border ${
                    c.account_status === "active" ? "hover:bg-gray-50" : "bg-red-50 text-red-700 border-red-200"
                  }`}
                >
                  {c.account_status === "active" ? "Suspend" : "Reactivate"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
