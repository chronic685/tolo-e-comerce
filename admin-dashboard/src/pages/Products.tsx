import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { exportToCsv } from "../lib/csvExport";
import type { AdminProduct } from "../types";
import { Categories } from "./Categories";

const STATUS_FILTERS = ["all", "submitted", "approved", "published", "paused", "archived", "draft"];

const statusColors: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  submitted: "bg-yellow-100 text-yellow-800",
  approved: "bg-blue-100 text-blue-800",
  published: "bg-emerald-100 text-emerald-800",
  paused: "bg-orange-100 text-orange-800",
  archived: "bg-red-100 text-red-800",
};

// Categories folded in as a sub-tab (same ?tab= pattern as DeliveryOps.tsx/
// PricingRules.tsx) rather than its own nav entry — it was an 80-line CRUD
// with no reason for a standalone page. Kept as a genuinely separate tab
// (not blended into the product list/filters below) so it never visually or
// functionally collides with STATUS_FILTERS — that's still exactly what it
// was before, just one tab among two instead of the whole page.
const TABS = [
  { key: "products", label: "Products" },
  { key: "categories", label: "Categories" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function isTabKey(value: string | null): value is TabKey {
  return TABS.some((t) => t.key === value);
}

export function Products() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const activeTab: TabKey = isTabKey(tabParam) ? tabParam : "products";

  function setTab(tab: TabKey) {
    setSearchParams(tab === "products" ? {} : { tab });
  }

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">Products</h1>
      <div className="flex items-center gap-1 border-b mb-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              activeTab === t.key ? "border-navy text-navy" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "products" && <ProductCatalog />}
      {activeTab === "categories" && <Categories />}
    </div>
  );
}

function ProductCatalog() {
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  async function load() {
    setLoading(true);
    let query = supabase
      .from("products")
      .select("id, merchant_id, name, slug, sku, base_price, status, rejection_reason, is_featured, created_at, merchants ( business_name ), categories ( name )")
      .order("created_at", { ascending: false })
      .limit(200);
    if (statusFilter !== "all") query = query.eq("status", statusFilter);
    if (search.trim()) query = query.or(`name.ilike.%${search.trim()}%,sku.ilike.%${search.trim()}%`);
    const { data } = await query;
    setProducts((data as unknown as AdminProduct[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  async function setStatus(p: AdminProduct, status: AdminProduct["status"], reason?: string) {
    await supabase.from("products").update({ status, rejection_reason: reason ?? null }).eq("id", p.id);
    setRejectingId(null);
    setRejectReason("");
    await load();
  }

  async function toggleFeatured(p: AdminProduct) {
    await supabase.from("products").update({ is_featured: !p.is_featured }).eq("id", p.id);
    await load();
  }

  function handleExport() {
    exportToCsv(
      `products-${statusFilter}-${new Date().toISOString().slice(0, 10)}.csv`,
      products.map((p) => ({
        id: p.id,
        name: p.name,
        merchant: p.merchants?.business_name ?? "",
        category: p.categories?.name ?? "",
        sku: p.sku ?? "",
        base_price_etb: p.base_price,
        status: p.status,
        is_featured: p.is_featured,
        created_at: p.created_at,
      })),
    );
  }

  return (
    <div>
      <div className="flex items-center justify-end mb-4">
        <button
          onClick={handleExport}
          disabled={products.length === 0}
          className="text-xs border px-3 py-1.5 rounded-md hover:bg-gray-50 disabled:opacity-40"
        >
          ⬇ Export CSV
        </button>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap items-center">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-full text-xs border capitalize ${
              statusFilter === s ? "bg-navy text-white border-navy" : "bg-white"
            }`}
          >
            {s}
          </button>
        ))}
        <input
          placeholder="Search name or SKU..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
          onBlur={load}
          className="border rounded-md px-3 py-1.5 text-sm ml-auto"
        />
      </div>

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : products.length === 0 ? (
        <p className="text-gray-500">No products in this view.</p>
      ) : (
        <div className="bg-white border rounded-lg divide-y">
          {products.map((p) => (
            <div key={p.id} className="p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">
                    {p.name} {p.is_featured && <span title="Featured">⭐</span>}
                  </p>
                  <p className="text-xs text-gray-500">
                    {p.merchants?.business_name ?? "—"} · {p.categories?.name ?? "Uncategorized"} · {p.base_price.toFixed(2)} ETB
                    {p.sku && ` · SKU ${p.sku}`}
                  </p>
                  {p.status === "draft" && p.rejection_reason && (
                    <p className="text-xs text-red-600 mt-0.5">Rejected: {p.rejection_reason}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${statusColors[p.status]}`}>{p.status}</span>
                  <button onClick={() => toggleFeatured(p)} className="text-xs border px-2 py-1 rounded-md hover:bg-gray-50">
                    {p.is_featured ? "Unfeature" : "Feature"}
                  </button>
                  {p.status === "submitted" && (
                    <>
                      <button
                        onClick={() => setStatus(p, "published")}
                        className="text-xs bg-navy text-white px-2 py-1 rounded-md hover:bg-navy-dark"
                      >
                        Approve &amp; Publish
                      </button>
                      <button
                        onClick={() => setRejectingId(rejectingId === p.id ? null : p.id)}
                        className="text-xs border px-2 py-1 rounded-md hover:bg-gray-50"
                      >
                        Reject
                      </button>
                    </>
                  )}
                  {p.status === "published" && (
                    <button onClick={() => setStatus(p, "paused")} className="text-xs border px-2 py-1 rounded-md hover:bg-gray-50">
                      Pause
                    </button>
                  )}
                  {p.status === "paused" && (
                    <button
                      onClick={() => setStatus(p, "published")}
                      className="text-xs bg-navy text-white px-2 py-1 rounded-md hover:bg-navy-dark"
                    >
                      Republish
                    </button>
                  )}
                  {p.status !== "archived" && (
                    <button onClick={() => setStatus(p, "archived")} className="text-xs border px-2 py-1 rounded-md hover:bg-gray-50">
                      Archive
                    </button>
                  )}
                </div>
              </div>
              {rejectingId === p.id && (
                <div className="mt-2 flex gap-2">
                  <input
                    placeholder="Reason for rejection"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    className="flex-1 border rounded-md px-2 py-1.5 text-sm"
                  />
                  <button
                    onClick={() => setStatus(p, "draft", rejectReason || "Rejected by Tolo")}
                    className="text-xs bg-red-600 text-white px-3 py-1.5 rounded-md hover:bg-red-700"
                  >
                    Confirm reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
