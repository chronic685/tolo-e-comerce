import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { ADMIN_PAGE_SIZE, Badge, Button, DataTable, Pagination, toast, totalPagesFor, usePagination, type DataTableColumn } from "@tolo/ui";
import type { Driver } from "../types";

export function Drivers() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const { page, from, to, setPage } = usePagination({ pageSize: ADMIN_PAGE_SIZE });
  const [form, setForm] = useState({ full_name: "", phone: "", vehicle_type: "", vehicle_plate: "" });

  async function load() {
    const { data, count } = await supabase.from("drivers").select("*", { count: "exact" }).order("full_name").range(from, to);
    setDrivers(data ?? []);
    setTotalCount(count ?? 0);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!form.full_name.trim() || !form.phone.trim()) return;
    const { error } = await supabase.from("drivers").insert(form);
    if (error) {
      toast.error(error.message);
      return;
    }
    // Sorted by name, not newest-first, so a new driver doesn't
    // predictably belong on the page currently showing -- reload rather
    // than guess.
    await load();
    setForm({ full_name: "", phone: "", vehicle_type: "", vehicle_plate: "" });
  }

  async function toggleActive(d: Driver) {
    const { error } = await supabase.from("drivers").update({ is_active: !d.is_active }).eq("id", d.id);
    if (error) return;
    setDrivers((prev) => prev.map((driver) => (driver.id === d.id ? { ...driver, is_active: !driver.is_active } : driver)));
  }

  async function bulkToggle(rows: Driver[], makeActive: boolean) {
    const targets = rows.filter((d) => d.is_active !== makeActive);
    if (targets.length === 0) return;
    await supabase.from("drivers").update({ is_active: makeActive }).in("id", targets.map((d) => d.id));
    setDrivers((prev) => prev.map((d) => (targets.some((t) => t.id === d.id) ? { ...d, is_active: makeActive } : d)));
  }

  const columns: DataTableColumn<Driver>[] = [
    {
      key: "name",
      header: "Driver",
      render: (d) => (
        <div>
          <p className="text-sm font-medium">{d.full_name}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {d.phone} · {[d.vehicle_type, d.vehicle_plate].filter(Boolean).join(" · ") || "—"}
          </p>
        </div>
      ),
      filterValue: (d) => `${d.full_name} ${d.phone}`,
      sortValue: (d) => d.full_name,
      csvValue: (d) => d.full_name,
    },
    {
      key: "status",
      header: "Status",
      render: (d) => <Badge variant={d.is_active ? "success" : "default"}>{d.is_active ? "Active" : "Inactive"}</Badge>,
      csvValue: (d) => (d.is_active ? "active" : "inactive"),
    },
    {
      key: "actions",
      header: "",
      render: (d) => (
        <Button size="sm" variant="outline" onClick={() => toggleActive(d)}>
          {d.is_active ? "Deactivate" : "Activate"}
        </Button>
      ),
    },
  ];

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-bold mb-4 dark:text-gray-100">Drivers</h1>

      <form onSubmit={handleAdd} className="bg-white dark:bg-navy-dark border dark:border-white/10 rounded-lg p-4 mb-4 flex gap-2 items-end flex-wrap">
        <input
          placeholder="Full name"
          value={form.full_name}
          onChange={(e) => setForm({ ...form, full_name: e.target.value })}
          className="border rounded-md px-2 py-1.5 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
        />
        <input
          placeholder="Phone"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          className="border rounded-md px-2 py-1.5 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
        />
        <input
          placeholder="Vehicle type"
          value={form.vehicle_type}
          onChange={(e) => setForm({ ...form, vehicle_type: e.target.value })}
          className="border rounded-md px-2 py-1.5 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
        />
        <input
          placeholder="Plate number"
          value={form.vehicle_plate}
          onChange={(e) => setForm({ ...form, vehicle_plate: e.target.value })}
          className="border rounded-md px-2 py-1.5 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
        />
        <button type="submit" className="bg-navy dark:bg-navy-light text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-navy-dark dark:hover:bg-navy">
          Add driver
        </button>
      </form>

      <DataTable
        storageKey="admin.drivers"
        columns={columns}
        rows={drivers}
        getRowId={(d) => d.id}
        bulkActions={[
          { label: "Activate", onAction: (rows) => bulkToggle(rows, true) },
          { label: "Deactivate", onAction: (rows) => bulkToggle(rows, false), variant: "outline" },
        ]}
      />
      <div className="mt-4">
        <Pagination page={page} totalPages={totalPagesFor(totalCount, ADMIN_PAGE_SIZE)} onPageChange={setPage} />
      </div>
    </div>
  );
}
