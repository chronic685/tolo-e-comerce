import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Star } from "lucide-react";
import { supabase } from "../lib/supabase";
import { exportToCsv } from "../lib/csvExport";
import { ADMIN_PAGE_SIZE, Badge, Button, DataTable, fetchAllRows, formatCurrency, Pagination, SkeletonRows, totalPagesFor, usePagination, type DataTableColumn } from "@tolo/ui";
import type { AdminProduct } from "../types";
import { Categories } from "./Categories";

const STATUS_FILTERS = ["all", "submitted", "approved", "published", "paused", "archived", "draft", "rejected"];

const statusVariant: Record<string, "default" | "warning" | "info" | "success" | "danger"> = {
  draft: "default",
  submitted: "warning",
  approved: "info",
  published: "success",
  paused: "warning",
  archived: "danger",
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
      <h1 className="text-xl font-bold mb-4 dark:text-gray-100">Products</h1>
      <div className="flex items-center gap-1 border-b dark:border-white/10 mb-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              activeTab === t.key ? "border-navy dark:border-navy-light text-navy dark:text-navy-light" : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
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
  const [totalCount, setTotalCount] = useState(0);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [committedSearch, setCommittedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const { page, from, to, setPage } = usePagination({ pageSize: ADMIN_PAGE_SIZE, resetKey: `${statusFilter}:${committedSearch}` });

  async function load() {
    setLoading(true);
    let query = supabase
      .from("products")
      .select(
        "id, merchant_id, name, slug, sku, base_price, status, rejection_reason, is_featured, created_at, merchants ( business_name ), categories ( name )",
        { count: "exact" },
      )
      .order("created_at", { ascending: false });
    // "rejected" isn't its own status — a rejected product falls back to
    // status='draft' with rejection_reason set (see setStatus's "draft"
    // branch below). Filtering on that combination surfaces it as its own
    // category in the UI without changing the underlying status model.
    if (statusFilter === "rejected") {
      query = query.eq("status", "draft").not("rejection_reason", "is", null);
    } else if (statusFilter !== "all") {
      query = query.eq("status", statusFilter);
    }
    if (committedSearch.trim()) query = query.or(`name.ilike.%${committedSearch.trim()}%,sku.ilike.%${committedSearch.trim()}%`);
    const { data, count } = await query.range(from, to);
    setProducts((data as unknown as AdminProduct[]) ?? []);
    setTotalCount(count ?? 0);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, committedSearch, from, to]);

  // Was `await load()` after both mutations below -- setLoading(true)
  // inside it wipes the whole filtered list to "Loading..." for a single
  // row's status/featured flag changing. The list is also filtered by
  // status, so a product that no longer matches the active filter (e.g.
  // approved while viewing "submitted") is removed rather than left
  // showing under the wrong tab; the "rejected" filter is really
  // status='draft' + a rejection_reason, so that combined condition is
  // checked the same way load()'s query itself does.
  function matchesStatusFilter(status: string, rejectionReason: string | null): boolean {
    if (statusFilter === "all") return true;
    if (statusFilter === "rejected") return status === "draft" && rejectionReason != null;
    return status === statusFilter;
  }

  async function setStatus(p: AdminProduct, status: AdminProduct["status"], reason?: string) {
    const rejection_reason = reason ?? null;
    const { error } = await supabase.from("products").update({ status, rejection_reason }).eq("id", p.id);
    setRejectingId(null);
    setRejectReason("");
    if (error) return;
    const stillMatches = matchesStatusFilter(status, rejection_reason);
    setProducts((prev) =>
      stillMatches
        ? prev.map((prod) => (prod.id === p.id ? { ...prod, status, rejection_reason } : prod))
        : prev.filter((prod) => prod.id !== p.id),
    );
    if (!stillMatches) setTotalCount((prev) => Math.max(0, prev - 1));
  }

  async function toggleFeatured(p: AdminProduct) {
    const { error } = await supabase.from("products").update({ is_featured: !p.is_featured }).eq("id", p.id);
    if (error) return;
    setProducts((prev) => prev.map((prod) => (prod.id === p.id ? { ...prod, is_featured: !prod.is_featured } : prod)));
  }

  async function bulkArchive(rows: AdminProduct[]) {
    const targets = rows.filter((p) => p.status !== "archived");
    if (targets.length === 0) return;
    await supabase.from("products").update({ status: "archived" }).in("id", targets.map((p) => p.id));
    await load();
  }

  // Exports every product matching the current status filter/search, not
  // just the page on screen.
  async function handleExport() {
    const rows = (await fetchAllRows((from, to) => {
      let query = supabase
        .from("products")
        .select("id, merchant_id, name, slug, sku, base_price, status, rejection_reason, is_featured, created_at, merchants ( business_name ), categories ( name )")
        .order("created_at", { ascending: false });
      if (statusFilter === "rejected") query = query.eq("status", "draft").not("rejection_reason", "is", null);
      else if (statusFilter !== "all") query = query.eq("status", statusFilter);
      if (committedSearch.trim()) query = query.or(`name.ilike.%${committedSearch.trim()}%,sku.ilike.%${committedSearch.trim()}%`);
      return query.range(from, to);
    })) as unknown as AdminProduct[];
    exportToCsv(
      `products-${statusFilter}-${new Date().toISOString().slice(0, 10)}.csv`,
      rows.map((p) => ({
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

  const columns: DataTableColumn<AdminProduct>[] = [
    {
      key: "name",
      header: "Product",
      render: (p) => (
        <div>
          <p className="font-medium text-sm flex items-center gap-1">
            {p.name}{" "}
            {p.is_featured && (
              <span title="Featured">
                <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
              </span>
            )}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {p.merchants?.business_name ?? "—"} · {p.categories?.name ?? "Uncategorized"} · {formatCurrency(p.base_price)}
            {p.sku && ` · SKU ${p.sku}`}
          </p>
          {p.status === "draft" && p.rejection_reason && <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">Rejected: {p.rejection_reason}</p>}
          {rejectingId === p.id && (
            <div className="mt-2 flex gap-2">
              <input
                placeholder="Reason for rejection"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="flex-1 border rounded-md px-2 py-1.5 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
              />
              <Button size="sm" variant="destructive" onClick={() => setStatus(p, "draft", rejectReason || "Rejected by Tolo")}>
                Confirm reject
              </Button>
            </div>
          )}
        </div>
      ),
      filterValue: (p) => `${p.name} ${p.sku ?? ""} ${p.merchants?.business_name ?? ""}`,
      sortValue: (p) => p.name,
      csvValue: (p) => p.name,
    },
    {
      key: "status",
      header: "Status",
      render: (p) => <Badge variant={statusVariant[p.status] ?? "default"} className="capitalize">{p.status}</Badge>,
      csvValue: (p) => p.status,
    },
    {
      key: "actions",
      header: "",
      render: (p) => (
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <Button size="sm" variant="outline" onClick={() => toggleFeatured(p)}>
            {p.is_featured ? "Unfeature" : "Feature"}
          </Button>
          {p.status === "submitted" && (
            <>
              <Button size="sm" onClick={() => setStatus(p, "published")}>
                Approve &amp; Publish
              </Button>
              <Button size="sm" variant="outline" onClick={() => setRejectingId(rejectingId === p.id ? null : p.id)}>
                Reject
              </Button>
            </>
          )}
          {p.status === "published" && (
            <Button size="sm" variant="outline" onClick={() => setStatus(p, "paused")}>
              Pause
            </Button>
          )}
          {p.status === "paused" && (
            <Button size="sm" onClick={() => setStatus(p, "published")}>
              Republish
            </Button>
          )}
          {p.status !== "archived" && (
            <Button size="sm" variant="outline" onClick={() => setStatus(p, "archived")}>
              Archive
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-full text-xs border capitalize ${
              statusFilter === s ? "bg-navy text-white border-navy dark:bg-navy-light dark:border-navy-light" : "bg-white dark:bg-navy-dark dark:border-white/20 dark:text-gray-300"
            }`}
          >
            {s}
          </button>
        ))}
        <input
          placeholder="Search name or SKU..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && setCommittedSearch(search)}
          onBlur={() => setCommittedSearch(search)}
          className="border rounded-md px-3 py-1.5 text-sm ml-auto dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
        />
      </div>

      {loading ? (
        <SkeletonRows />
      ) : (
        <>
          <DataTable
            storageKey="admin.products"
            columns={columns}
            rows={products}
            getRowId={(p) => p.id}
            onExportAll={handleExport}
            emptyMessage="No products in this view."
            bulkActions={[{ label: "Archive", onAction: bulkArchive, variant: "destructive" }]}
          />
          <div className="mt-4">
            <Pagination page={page} totalPages={totalPagesFor(totalCount, ADMIN_PAGE_SIZE)} onPageChange={setPage} />
          </div>
        </>
      )}
    </div>
  );
}
