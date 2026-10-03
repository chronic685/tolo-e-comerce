import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { ADMIN_PAGE_SIZE, Badge, Button, DataTable, Pagination, SkeletonRows, totalPagesFor, usePagination, useTranslation, type DataTableColumn } from "@tolo/ui";
import type { Delivery, Driver } from "../types";

const STATUS_FLOW: Record<string, string[]> = {
  pending: ["assigned"],
  assigned: ["picked_up", "failed"],
  picked_up: ["in_transit"],
  in_transit: ["delivered", "failed"],
};

const STATUS_KEYS: Record<string, string> = {
  pending: "deliveryStatus.pending",
  assigned: "deliveryStatus.assigned",
  picked_up: "deliveryStatus.picked_up",
  in_transit: "deliveryStatus.in_transit",
  delivered: "deliveryStatus.delivered",
  failed: "deliveryStatus.failed",
};

export function Deliveries() {
  const { t } = useTranslation();
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { page, from, to, setPage } = usePagination({ pageSize: ADMIN_PAGE_SIZE });

  async function load() {
    setLoading(true);
    const { data, count } = await supabase
      .from("deliveries")
      .select(
        `id, merchant_order_id, driver_id, status, pickup_address, pickup_contact_name, pickup_contact_phone,
         dropoff_address, dropoff_contact_name, dropoff_contact_phone, created_at,
         drivers ( full_name ),
         merchant_orders ( merchants ( business_name ) )`,
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(from, to);
    setDeliveries((data as unknown as Delivery[]) ?? []);
    setTotalCount(count ?? 0);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  useEffect(() => {
    supabase.from("drivers").select("*").eq("is_active", true).then(({ data }) => setDrivers(data ?? []));
  }, []);

  // Was `await load()` after every mutation — load() sets loading=true
  // first, which unmounts the entire list behind a bare "Loading..." (see
  // the `if (loading) return ...` below), flashing the whole page for what
  // should be a one-row update. Patching the affected row into state
  // directly avoids both the network round-trip and the flash; the
  // optimistic patch only applies once the call is confirmed to have
  // succeeded, so a failed request leaves the row exactly as it was rather
  // than lying about the outcome.
  async function assignDriver(delivery: Delivery, driverId: string) {
    setBusyId(delivery.id);
    const { error } = await supabase.functions.invoke("delivery-dispatch", {
      body: { delivery_id: delivery.id, status: "assigned", driver_id: driverId },
    });
    setBusyId(null);
    if (error) return;
    const driver = drivers.find((d) => d.id === driverId);
    setDeliveries((prev) =>
      prev.map((d) => (d.id === delivery.id ? { ...d, status: "assigned", driver_id: driverId, drivers: driver ? { full_name: driver.full_name } : d.drivers } : d)),
    );
  }

  async function advanceStatus(delivery: Delivery, status: string) {
    setBusyId(delivery.id);
    const { error } = await supabase.functions.invoke("delivery-dispatch", { body: { delivery_id: delivery.id, status } });
    setBusyId(null);
    if (error) return;
    setDeliveries((prev) => prev.map((d) => (d.id === delivery.id ? { ...d, status } : d)));
  }

  const columns: DataTableColumn<Delivery>[] = [
    {
      key: "merchant",
      header: t("deliveries.column"),
      render: (d) => (
        <div>
          <p className="font-medium text-sm">{d.merchant_orders?.merchants?.business_name}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">{new Date(d.created_at).toLocaleString()}</p>
          <div className="grid grid-cols-2 gap-3 text-xs mt-2 max-w-md">
            <div>
              <p className="font-medium text-gray-500 dark:text-gray-400">{t("deliveries.pickup")}</p>
              <p className="dark:text-gray-200">{d.pickup_contact_name} · {d.pickup_contact_phone}</p>
              <p className="text-gray-500 dark:text-gray-400">{d.pickup_address ?? t("deliveries.noPickupAddress")}</p>
            </div>
            <div>
              <p className="font-medium text-gray-500 dark:text-gray-400">{t("deliveries.dropoff")}</p>
              <p className="dark:text-gray-200">{d.dropoff_contact_name} · {d.dropoff_contact_phone}</p>
              <p className="text-gray-500 dark:text-gray-400">{d.dropoff_address ?? t("deliveries.noDropoffAddress")}</p>
            </div>
          </div>
        </div>
      ),
      filterValue: (d) => d.merchant_orders?.merchants?.business_name ?? "",
      sortValue: (d) => d.created_at,
      csvValue: (d) => d.merchant_orders?.merchants?.business_name ?? "",
    },
    {
      key: "status",
      header: t("common.status"),
      render: (d) => <Badge className="capitalize">{STATUS_KEYS[d.status] ? t(STATUS_KEYS[d.status]) : d.status}</Badge>,
      csvValue: (d) => d.status,
    },
    {
      key: "actions",
      header: "",
      render: (d) => (
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {d.status === "pending" && (
            <select
              onChange={(e) => e.target.value && assignDriver(d, e.target.value)}
              disabled={busyId === d.id}
              defaultValue=""
              className="text-xs border rounded-md px-2 py-1.5 dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
            >
              <option value="" disabled>
                {t("deliveries.assignDriverEllipsis")}
              </option>
              {drivers.map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.full_name}
                </option>
              ))}
            </select>
          )}
          {d.driver_id && <span className="text-xs text-gray-500 dark:text-gray-400">{t("deliveries.driverLabel", { name: d.drivers?.full_name ?? "" })}</span>}
          {(STATUS_FLOW[d.status] ?? []).map((next) => (
            <Button key={next} size="sm" variant="outline" onClick={() => advanceStatus(d, next)} disabled={busyId === d.id} className="capitalize">
              {t("deliveries.markAction", { status: STATUS_KEYS[next] ? t(STATUS_KEYS[next]) : next })}
            </Button>
          ))}
        </div>
      ),
    },
  ];

  return (
    <div>
      <h1 className="text-xl font-bold mb-4 dark:text-gray-100">{t("deliveries.title")}</h1>
      {loading ? (
        <SkeletonRows />
      ) : deliveries.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400">{t("deliveries.noDeliveriesYet")}</p>
      ) : (
        <>
          <DataTable storageKey="admin.deliveries" columns={columns} rows={deliveries} getRowId={(d) => d.id} />
          <div className="mt-4">
            <Pagination page={page} totalPages={totalPagesFor(totalCount, ADMIN_PAGE_SIZE)} onPageChange={setPage} />
          </div>
        </>
      )}
    </div>
  );
}
