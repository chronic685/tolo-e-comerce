import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { ADMIN_PAGE_SIZE, Badge, Button, DataTable, Pagination, toast, totalPagesFor, usePagination, useTranslation, type DataTableColumn } from "@tolo/ui";
import type { DeliveryZone } from "../types";

const emptyForm = {
  name: "",
  description: "",
  center_latitude: "",
  center_longitude: "",
  radius_km: "5",
  delivery_fee: "50",
  free_delivery_threshold: "",
  max_distance_km: "",
  estimated_delivery_minutes: "45",
};

export function DeliveryZones() {
  const { t } = useTranslation();
  const [zones, setZones] = useState<DeliveryZone[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const { page, from, to, setPage } = usePagination({ pageSize: ADMIN_PAGE_SIZE });
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  async function load() {
    const { data, count } = await supabase
      .from("delivery_zones")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);
    setZones((data as DeliveryZone[]) ?? []);
    setTotalCount(count ?? 0);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  async function toggleActive(z: DeliveryZone) {
    const { error } = await supabase.from("delivery_zones").update({ is_active: !z.is_active }).eq("id", z.id);
    if (error) return;
    setZones((prev) => prev.map((zone) => (zone.id === z.id ? { ...zone, is_active: !zone.is_active } : zone)));
  }

  async function bulkToggle(rows: DeliveryZone[], makeActive: boolean) {
    const targets = rows.filter((z) => z.is_active !== makeActive);
    if (targets.length === 0) return;
    await supabase.from("delivery_zones").update({ is_active: makeActive }).in("id", targets.map((z) => z.id));
    setZones((prev) => prev.map((z) => (targets.some((t) => t.id === z.id) ? { ...z, is_active: makeActive } : z)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.center_latitude || !form.center_longitude) {
      toast.error(t("deliveryZones.nameAndCoordinatesRequired"));
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("delivery_zones")
      .insert({
        name: form.name.trim(),
        description: form.description.trim() || null,
        center_latitude: Number(form.center_latitude),
        center_longitude: Number(form.center_longitude),
        radius_km: Number(form.radius_km),
        delivery_fee: Number(form.delivery_fee),
        free_delivery_threshold: form.free_delivery_threshold ? Number(form.free_delivery_threshold) : null,
        max_distance_km: form.max_distance_km ? Number(form.max_distance_km) : null,
        estimated_delivery_minutes: form.estimated_delivery_minutes ? Number(form.estimated_delivery_minutes) : null,
      })
      .select()
      .single();
    setSaving(false);
    if (error) {
      toast.error(t("deliveryZones.saveError"));
      return;
    }
    if (page === 1) await load();
    else setPage(1);
    setForm(emptyForm);
    setShowForm(false);
  }

  const columns: DataTableColumn<DeliveryZone>[] = [
    {
      key: "name",
      header: t("deliveryZones.zoneColumn"),
      render: (z) => (
        <div>
          <p className="text-sm font-medium">{z.name}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t("deliveryZones.radiusAndFee", { radius: z.radius_km, fee: z.delivery_fee.toFixed(2) })}
            {z.free_delivery_threshold ? t("deliveryZones.freeAboveSuffix", { amount: z.free_delivery_threshold }) : ""}
            {z.estimated_delivery_minutes ? t("deliveryZones.estMinutesSuffix", { minutes: z.estimated_delivery_minutes }) : ""}
          </p>
        </div>
      ),
      filterValue: (z) => z.name,
      sortValue: (z) => z.name,
      csvValue: (z) => z.name,
    },
    {
      key: "status",
      header: t("common.status"),
      render: (z) => <Badge variant={z.is_active ? "success" : "default"}>{z.is_active ? t("common.active") : t("common.inactive")}</Badge>,
      csvValue: (z) => (z.is_active ? "active" : "inactive"),
    },
    {
      key: "actions",
      header: "",
      render: (z) => (
        <Button size="sm" variant="outline" onClick={() => toggleActive(z)}>
          {z.is_active ? t("banners.deactivate") : t("banners.activate")}
        </Button>
      ),
    },
  ];

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-bold mb-1 dark:text-gray-100">{t("deliveryZones.title")}</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{t("deliveryZones.description")}</p>

      <button onClick={() => setShowForm((s) => !s)} className="bg-navy dark:bg-navy-light text-white text-sm px-4 py-2 rounded-md hover:bg-navy-dark dark:hover:bg-navy mb-4">
        {showForm ? t("common.cancel") : t("deliveryZones.newZone")}
      </button>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white dark:bg-navy-dark border dark:border-white/10 rounded-lg p-4 mb-4 space-y-3">
          <input
            placeholder={t("deliveryZones.zoneNamePlaceholder")}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full border rounded-md px-3 py-2 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
          />
          <input
            placeholder={t("deliveryZones.descriptionPlaceholder")}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full border rounded-md px-3 py-2 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
          />
          <div className="grid grid-cols-3 gap-2">
            <input
              type="number"
              step="0.000001"
              placeholder={t("deliveryZones.centerLatitude")}
              value={form.center_latitude}
              onChange={(e) => setForm({ ...form, center_latitude: e.target.value })}
              className="border rounded-md px-2 py-1.5 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
            />
            <input
              type="number"
              step="0.000001"
              placeholder={t("deliveryZones.centerLongitude")}
              value={form.center_longitude}
              onChange={(e) => setForm({ ...form, center_longitude: e.target.value })}
              className="border rounded-md px-2 py-1.5 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
            />
            <input
              type="number"
              placeholder={t("deliveryZones.radiusKm")}
              value={form.radius_km}
              onChange={(e) => setForm({ ...form, radius_km: e.target.value })}
              className="border rounded-md px-2 py-1.5 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t("deliveryZones.deliveryFeeEtb")}</label>
              <input
                type="number"
                value={form.delivery_fee}
                onChange={(e) => setForm({ ...form, delivery_fee: e.target.value })}
                className="w-full border rounded-md px-2 py-1.5 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t("deliveryZones.freeAboveOptional")}</label>
              <input
                type="number"
                value={form.free_delivery_threshold}
                onChange={(e) => setForm({ ...form, free_delivery_threshold: e.target.value })}
                className="w-full border rounded-md px-2 py-1.5 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t("deliveryZones.estDeliveryMinutes")}</label>
              <input
                type="number"
                value={form.estimated_delivery_minutes}
                onChange={(e) => setForm({ ...form, estimated_delivery_minutes: e.target.value })}
                className="w-full border rounded-md px-2 py-1.5 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="bg-navy dark:bg-navy-light text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-navy-dark dark:hover:bg-navy disabled:opacity-60"
          >
            {saving ? t("deliveryZones.creating") : t("deliveryZones.createZone")}
          </button>
        </form>
      )}

      <DataTable
        storageKey="admin.deliveryZones"
        columns={columns}
        rows={zones}
        getRowId={(z) => z.id}
        emptyMessage={t("deliveryZones.noZonesConfigured")}
        bulkActions={[
          { label: t("banners.activate"), onAction: (rows) => bulkToggle(rows, true) },
          { label: t("banners.deactivate"), onAction: (rows) => bulkToggle(rows, false), variant: "outline" },
        ]}
      />
      <div className="mt-4">
        <Pagination page={page} totalPages={totalPagesFor(totalCount, ADMIN_PAGE_SIZE)} onPageChange={setPage} />
      </div>
    </div>
  );
}
