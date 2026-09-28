import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { exportToCsv } from "../lib/csvExport";
import { ADMIN_PAGE_SIZE, ExportCsvButton, Pagination, SkeletonRows, totalPagesFor, usePagination } from "@tolo/ui";
import type { InventoryMovement } from "../types";

const TYPE_FILTERS = ["all", "restock", "sale", "return", "adjustment", "reserve", "release"];

const typeColors: Record<string, string> = {
  restock: "bg-emerald-100 text-emerald-800",
  sale: "bg-blue-100 text-blue-800",
  return: "bg-orange-100 text-orange-800",
  adjustment: "bg-yellow-100 text-yellow-800",
  reserve: "bg-gray-100 text-gray-700",
  release: "bg-gray-100 text-gray-700",
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
    let query = supabase
      .from("inventory_movements")
      .select("id, variant_id, movement_type, quantity, reference_type, reference_id, created_at, product_variants ( sku, products ( name ) )")
      .order("created_at", { ascending: false });
    if (typeFilter !== "all") query = query.eq("movement_type", typeFilter);
    const { data } = await query.range(0, 4999);
    exportToCsv(
      `inventory-movements-${typeFilter}-${new Date().toISOString().slice(0, 10)}.csv`,
      ((data as unknown as InventoryMovement[]) ?? []).map((m) => ({
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

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">Inventory Movements</h1>
        <ExportCsvButton onExport={handleExport} disabled={movements.length === 0} />
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {TYPE_FILTERS.map((t) => (
          <button
            key={t}
            onClick={() => setTypeFilter(t)}
            className={`px-3 py-1.5 rounded-full text-xs border capitalize ${
              typeFilter === t ? "bg-navy text-white border-navy" : "bg-white"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <SkeletonRows />
      ) : movements.length === 0 ? (
        <p className="text-gray-500">No movements in this view.</p>
      ) : (
        <>
        <div className="bg-white border rounded-lg divide-y">
          {movements.map((m) => (
            <div key={m.id} className="p-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{m.product_variants?.products?.name ?? "Unknown product"}</p>
                <p className="text-xs text-gray-500">
                  {m.product_variants?.sku ?? "—"} · {new Date(m.created_at).toLocaleString()}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-sm font-semibold">{m.quantity > 0 ? "+" : ""}{m.quantity}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${typeColors[m.movement_type] ?? "bg-gray-100"}`}>
                  {m.movement_type}
                </span>
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
