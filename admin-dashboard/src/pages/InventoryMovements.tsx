import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { exportToCsv } from "../lib/csvExport";
import { ADMIN_PAGE_SIZE, Badge, DataTable, fetchAllRows, Pagination, SkeletonRows, totalPagesFor, usePagination, type DataTableColumn } from "@tolo/ui";
import type { InventoryMovement } from "../types";

const TYPE_FILTERS = ["all", "restock", "sale", "return", "adjustment", "reserve", "release"];

const typeVariant: Record<string, "success" | "info" | "warning" | "default"> = {
  restock: "success",
  sale: "info",
  return: "warning",
  adjustment: "warning",
  reserve: "default",
  release: "default",
};

export function InventoryMovements() {
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [typeFilter, setTypeFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const { page, from, to, setPage } = usePagination({ pageSize: ADMIN_PAGE_SIZE, resetKey: typeFilter });

  async function load() {
    setLoading(true);
    let query = supabase
      .from("inventory_movements")
      .select("id, variant_id, movement_type, quantity, reference_type, reference_id, created_at, product_variants ( sku, products ( name ) )", {
        count: "exact",
      })
      .order("created_at", { ascending: false });
    if (typeFilter !== "all") query = query.eq("movement_type", typeFilter);
    const { data, count } = await query.range(from, to);
    setMovements((data as unknown as InventoryMovement[]) ?? []);
    setTotalCount(count ?? 0);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, from, to]);

  // Exports every movement matching the current type filter, not just the
  // page on screen.
  async function handleExport() {
    const rows = (await fetchAllRows((from, to) => {
      let query = supabase
        .from("inventory_movements")
        .select("id, variant_id, movement_type, quantity, reference_type, reference_id, created_at, product_variants ( sku, products ( name ) )")
        .order("created_at", { ascending: false });
      if (typeFilter !== "all") query = query.eq("movement_type", typeFilter);
      return query.range(from, to);
    })) as unknown as InventoryMovement[];
    exportToCsv(
      `inventory-movements-${typeFilter}-${new Date().toISOString().slice(0, 10)}.csv`,
      rows.map((m) => ({
        id: m.id,
        product: m.product_variants?.products?.name ?? "",
        sku: m.product_variants?.sku ?? "",
        movement_type: m.movement_type,
        quantity: m.quantity,
        reference_type: m.reference_type ?? "",
        created_at: m.created_at,
      })),
    );
  }

  const columns: DataTableColumn<InventoryMovement>[] = [
    {
      key: "product",
      header: "Product",
      render: (m) => (
        <div>
          <p className="text-sm font-medium">{m.product_variants?.products?.name ?? "Unknown product"}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {m.product_variants?.sku ?? "—"} · {new Date(m.created_at).toLocaleString()}
          </p>
        </div>
      ),
      filterValue: (m) => `${m.product_variants?.products?.name ?? ""} ${m.product_variants?.sku ?? ""}`,
      sortValue: (m) => m.created_at,
      csvValue: (m) => m.product_variants?.products?.name ?? "",
    },
    {
      key: "quantity",
      header: "Qty",
      render: (m) => <span className="text-sm font-semibold">{m.quantity > 0 ? "+" : ""}{m.quantity}</span>,
      sortValue: (m) => m.quantity,
      csvValue: (m) => m.quantity,
      align: "right",
    },
    {
      key: "type",
      header: "Type",
      render: (m) => <Badge variant={typeVariant[m.movement_type] ?? "default"} className="capitalize">{m.movement_type}</Badge>,
      csvValue: (m) => m.movement_type,
    },
  ];

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-bold mb-4 dark:text-gray-100">Inventory Movements</h1>

      <div className="flex gap-2 mb-4 flex-wrap">
        {TYPE_FILTERS.map((t) => (
          <button
            key={t}
            onClick={() => setTypeFilter(t)}
            className={`px-3 py-1.5 rounded-full text-xs border capitalize ${
              typeFilter === t ? "bg-navy text-white border-navy dark:bg-navy-light dark:border-navy-light" : "bg-white dark:bg-navy-dark dark:border-white/20 dark:text-gray-300"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <SkeletonRows />
      ) : movements.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400">No movements in this view.</p>
      ) : (
        <>
          <DataTable storageKey="admin.inventoryMovements" columns={columns} rows={movements} getRowId={(m) => m.id} onExportAll={handleExport} />
          <div className="mt-4">
            <Pagination page={page} totalPages={totalPagesFor(totalCount, ADMIN_PAGE_SIZE)} onPageChange={setPage} />
          </div>
        </>
      )}
    </div>
  );
}
