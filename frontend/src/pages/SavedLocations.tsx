import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import {
  Button,
  CUSTOMER_PAGE_SIZE,
  EmptyState,
  Pagination,
  SkeletonRows,
  toast,
  totalPagesFor,
  usePagination,
  useTranslation,
} from "@tolo/ui";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { getCurrentLocation } from "../lib/geolocation";
import type { Address } from "../types";

const EMPTY_FORM = {
  label: "Home",
  recipient_name: "",
  phone: "",
  line1: "",
  city: "",
  sub_city: "",
  landmark: "",
  latitude: null as number | null,
  longitude: null as number | null,
};

// The stored `label` value stays a fixed English enum ("Home"/"Work"/
// "Other", same as the dropdown's option values) -- only its displayed
// text is translated, same pattern as orderStatus.* elsewhere.
const LABEL_KEYS: Record<string, string> = {
  Home: "savedLocations.labelHome",
  Work: "savedLocations.labelWork",
  Other: "savedLocations.labelOther",
};

export function SavedLocations() {
  const { t } = useTranslation();
  function labelText(label: string | null): string {
    if (!label) return t("checkout.addressFallback");
    return LABEL_KEYS[label] ? t(LABEL_KEYS[label]) : label;
  }
  const { user } = useAuth();
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [locating, setLocating] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const { page, from, to, setPage } = usePagination({ pageSize: CUSTOMER_PAGE_SIZE });

  useEffect(() => {
    if (user) load();
  }, [user, from, to]);

  async function load() {
    if (!user) return;
    setLoading(true);
    const { data, count } = await supabase
      .from("addresses")
      .select("*", { count: "exact" })
      .eq("customer_id", user.id)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, to);
    setAddresses(data ?? []);
    setTotalCount(count ?? 0);
    setLoading(false);
  }

  async function handleUseCurrentLocation() {
    setLocating(true);
    try {
      const loc = await getCurrentLocation();
      setForm((f) => ({
        ...f,
        latitude: loc.latitude,
        longitude: loc.longitude,
        line1: loc.line1 || f.line1,
        city: loc.city || f.city,
        sub_city: loc.subCity || f.sub_city,
      }));
    } catch {
      // The browser Geolocation API's own error text is always English and
      // never one of our known backend errors -- never shown, just the
      // translated fallback (same treatment as Checkout.tsx).
      toast.error(t("checkout.couldNotGetLocation"));
    } finally {
      setLocating(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    const { error } = await supabase
      .from("addresses")
      .insert({ customer_id: user.id, ...form, country: "ET", is_default: totalCount === 0 })
      .select()
      .single();
    if (error) {
      toast.error(t("savedLocations.saveError"));
      return;
    }
    setForm(EMPTY_FORM);
    setShowForm(false);
    // Reloads rather than patching the array in place -- with a paginated
    // list, the canonical page + total count only the server knows for
    // sure, especially now that a new row can push the current page's
    // count/ordering around.
    await load();
  }

  async function handleSetDefault(id: string) {
    if (!user) return;
    await supabase.from("addresses").update({ is_default: false }).eq("customer_id", user.id);
    await supabase.from("addresses").update({ is_default: true }).eq("id", id);
    await load();
  }

  // Same inline-confirm pattern as OrderDetail.tsx's "Cancel order" button —
  // the delete call only lives inside this handler, only ever invoked from
  // the "Yes, delete" button below, never on the first click.
  async function handleDelete(id: string) {
    setConfirmingDeleteId(null);
    const { error } = await supabase.from("addresses").delete().eq("id", id);
    if (error) {
      toast.error(t("savedLocations.deleteInUseError"));
      return;
    }
    await load();
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-xl font-bold mb-4">{t("account.savedLocations")}</h1>

      {loading ? (
        <SkeletonRows count={3} />
      ) : addresses.length === 0 && !showForm ? (
        <EmptyState
          icon={MapPin}
          title={t("savedLocations.noLocationsTitle")}
          description={t("savedLocations.noLocationsDescription")}
          action={<Button onClick={() => setShowForm(true)}>{t("savedLocations.addLocation")}</Button>}
        />
      ) : (
        <div className="space-y-2 mb-4">
          {addresses.map((a) => (
            <div key={a.id} className="bg-white dark:bg-navy-dark border rounded-lg p-3 text-sm">
              <div className="flex justify-between items-start gap-2">
                <div>
                  <p className="font-medium">
                    {labelText(a.label)}
                    {a.is_default && (
                      <span className="ml-2 text-xs bg-navy-50 text-navy rounded-full px-2 py-0.5">{t("savedLocations.default")}</span>
                    )}
                  </p>
                  <p className="text-gray-600 dark:text-gray-300 mt-0.5">
                    {a.recipient_name}, {a.phone}
                  </p>
                  <p className="text-gray-500 dark:text-gray-400 flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 flex-shrink-0" />
                    {a.line1}, {a.city}
                    {a.latitude && <span className="text-xs text-gray-400 dark:text-gray-500"> {t("checkout.gpsConfirmed")}</span>}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {!a.is_default && (
                    <button onClick={() => handleSetDefault(a.id)} className="text-xs text-navy font-medium">
                      {t("savedLocations.setDefault")}
                    </button>
                  )}
                  {confirmingDeleteId !== a.id && (
                    <button onClick={() => setConfirmingDeleteId(a.id)} className="text-xs text-red-600 font-medium">
                      {t("common.delete")}
                    </button>
                  )}
                </div>
              </div>
              {confirmingDeleteId === a.id && (
                <div className="flex items-center gap-2 flex-wrap mt-2 pt-2 border-t">
                  <span className="text-xs text-gray-700 dark:text-gray-300">{t("savedLocations.deleteConfirm")}</span>
                  <button
                    onClick={() => handleDelete(a.id)}
                    className="text-xs bg-red-600 text-white px-3 py-1.5 rounded-md hover:bg-red-700"
                  >
                    {t("savedLocations.yesDelete")}
                  </button>
                  <button
                    onClick={() => setConfirmingDeleteId(null)}
                    className="text-xs border px-3 py-1.5 rounded-md hover:bg-gray-50 dark:bg-white/5"
                  >
                    {t("orders.noKeepIt")}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!loading && addresses.length > 0 && (
        <div className="mb-4">
          <Pagination page={page} totalPages={totalPagesFor(totalCount, CUSTOMER_PAGE_SIZE)} onPageChange={setPage} />
        </div>
      )}

      {!showForm ? (
        <button onClick={() => setShowForm(true)} className="text-navy text-sm font-medium">
          {t("savedLocations.addNewLocation")}
        </button>
      ) : (
        <form onSubmit={handleSave} className="bg-white dark:bg-navy-dark border rounded-lg p-4 space-y-2">
          <button
            type="button"
            onClick={handleUseCurrentLocation}
            disabled={locating}
            className="w-full border-2 border-navy text-navy rounded-md px-3 py-2 text-sm font-medium hover:bg-navy-50 disabled:opacity-60"
          >
            {locating ? (
              t("checkout.gettingLocation")
            ) : (
              <span className="inline-flex items-center justify-center gap-1.5 w-full">
                <MapPin className="w-4 h-4" />
                {t("checkout.useCurrentLocation")}
              </span>
            )}
          </button>
          {form.latitude && (
            <p className="text-xs text-navy bg-navy-50 rounded-md px-3 py-2 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
              {t("checkout.locationConfirmedNote")}
            </p>
          )}
          <select
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            className="w-full border rounded-md px-3 py-2 text-sm"
          >
            <option value="Home">{t("savedLocations.labelHome")}</option>
            <option value="Work">{t("savedLocations.labelWork")}</option>
            <option value="Other">{t("savedLocations.labelOther")}</option>
          </select>
          <input
            placeholder={t("checkout.recipientName")}
            value={form.recipient_name}
            onChange={(e) => setForm({ ...form, recipient_name: e.target.value })}
            required
            className="w-full border rounded-md px-3 py-2 text-sm"
          />
          <input
            placeholder={t("auth.phone")}
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            required
            className="w-full border rounded-md px-3 py-2 text-sm"
          />
          <input
            placeholder={t("checkout.streetArea")}
            value={form.line1}
            onChange={(e) => setForm({ ...form, line1: e.target.value })}
            required
            className="w-full border rounded-md px-3 py-2 text-sm"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              placeholder={t("checkout.city")}
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
              required
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
            <input
              placeholder={t("checkout.subCityOptional")}
              value={form.sub_city}
              onChange={(e) => setForm({ ...form, sub_city: e.target.value })}
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
          </div>
          <input
            placeholder={t("checkout.landmarkOptional")}
            value={form.landmark}
            onChange={(e) => setForm({ ...form, landmark: e.target.value })}
            className="w-full border rounded-md px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button type="submit" className="bg-navy text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-navy-dark">
              {t("checkout.saveAddress")}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setForm(EMPTY_FORM);
              }}
              className="text-sm text-gray-500 dark:text-gray-400"
            >
              {t("common.cancel")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
