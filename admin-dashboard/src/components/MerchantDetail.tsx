import { useEffect, useState, type ReactNode } from "react";
import {
  Badge,
  Button,
  ConfirmDialog,
  DAY_KEYS,
  SkeletonRows,
  formatCurrency,
  formatDateTime,
  toast,
  translateServerError,
  useTranslation,
  type DayKey,
  type OperatingHours,
} from "@tolo/ui";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { TinValue } from "./TinValue";

interface AuditRow {
  id: string;
  action: string;
  created_at: string;
  actor: string | null;
  metadata: Record<string, unknown>;
}

export interface MerchantDetailData {
  merchant: {
    id: string;
    business_name: string;
    category_id: string | null;
    status: string;
    source: "dashboard" | "tolo_app";
    location: string | null;
    city: string | null;
    sub_city: string | null;
    woreda: string | null;
    landmark: string | null;
    latitude: number | null;
    longitude: number | null;
    created_at: string;
    approved_at: string | null;
    rejection_reason: string | null;
    suspension_reason: string | null;
    closed_at: string | null;
    close_reason: string | null;
  };
  private: {
    phone: string | null;
    email: string | null;
    owner_full_name: string | null;
    owner_phone: string | null;
    owner_email: string | null;
    business_registration_number: string | null;
  } | null;
  store: {
    name: string;
    description: string | null;
    operating_hours: OperatingHours | null;
    logo_url: string | null;
    banner_url: string | null;
    pickup_address: string | null;
    prep_time_minutes: number | null;
    status: string;
  } | null;
  owner: { id: string; full_name: string | null } | null;
  tin: string | null;
  products: { total: number; published: number };
  orders: { total: number; by_status: Record<string, number> };
  rating: { avg: number | null; count: number | null };
  commission_rules: { id: string; rate_percent: number; is_active?: boolean }[];
  wallet_balance: number | null;
  payouts: { id: string; total_amount: number; status: string; created_at: string }[];
  applications: { id: string; status: string; created_at: string; reviewed_at: string | null; admin_note: string | null }[];
  documents: { id: string; doc_type: string; file_url: string; file_name: string | null; status: string }[];
  audit: AuditRow[];
  can_hard_delete: boolean;
  active_orders: number;
}

type Form = Record<string, string>;

const inputClass = "w-full border rounded-md px-2 py-1.5 text-sm bg-white dark:bg-navy dark:border-white/20 dark:text-gray-100 disabled:opacity-60";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <div className="text-sm dark:text-gray-100 break-words">{children}</div>
    </div>
  );
}

function auditSummary(row: AuditRow): string {
  const parts: string[] = [];
  for (const [scope, value] of Object.entries(row.metadata ?? {})) {
    const v = value as { before?: Record<string, unknown>; after?: Record<string, unknown> };
    if (v && typeof v === "object" && v.after) {
      for (const key of Object.keys(v.after)) parts.push(`${key}: ${String(v.before?.[key] ?? "—")} → ${String(v.after[key] ?? "—")}`);
    } else if (typeof value === "string" || typeof value === "number") {
      parts.push(`${scope}: ${String(value)}`);
    } else if (scope === "before_last4" || scope === "after_last4") {
      parts.push(`${scope}: ${String(value)}`);
    }
  }
  return parts.join("; ");
}

// Public storage URL -> { bucket, path }, so a deleted merchant's files can be removed through the Storage API.
function storageTarget(url: string): { bucket: string; path: string } | null {
  const match = url.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+?)(?:\?.*)?$/);
  return match ? { bucket: match[1], path: decodeURIComponent(match[2]) } : null;
}

/** Everything about one merchant, for an admin: business, store, contact, TIN, status, numbers, payouts, applications,
 * documents and the audit trail. Reads through admin_merchant_detail() and writes through admin_update_merchant(),
 * set_merchant_tin(), admin_close_merchant(), admin_reopen_merchant() and admin_delete_merchant() (migrations 0094, 0099),
 * which enforce who may do what; the buttons staff may not use are not rendered for them. */
export function MerchantDetail({ merchantId, onChanged, onDeleted }: { merchantId: string; onChanged?: () => void; onDeleted?: () => void }) {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();
  const [data, setData] = useState<MerchantDetailData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Form>({});
  const [hours, setHours] = useState<OperatingHours>({});
  const [saving, setSaving] = useState(false);
  const [tinEdit, setTinEdit] = useState<string | null>(null);
  const [statusReason, setStatusReason] = useState<{ kind: "suspended" | "rejected"; text: string } | null>(null);
  const [dialog, setDialog] = useState<"close" | "delete" | null>(null);
  const [reason, setReason] = useState("");
  const [working, setWorking] = useState(false);

  async function load() {
    const { data: detail, error } = await supabase.rpc("admin_merchant_detail", { p_merchant_id: merchantId });
    if (error || !detail) {
      setLoadError(true);
      return;
    }
    setLoadError(false);
    setData(detail as MerchantDetailData);
  }

  useEffect(() => {
    setData(null);
    setEditing(false);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchantId]);

  useEffect(() => {
    supabase.from("categories").select("id, name").order("name").then(({ data: rows }) => setCategories(rows ?? []));
  }, []);

  if (loadError) return <p className="text-sm text-red-600 dark:text-red-400">{t("merchantDetail.loadError")}</p>;
  if (!data) return <SkeletonRows count={6} />;

  const { merchant, store } = data;
  const priv = data.private;
  const closed = merchant.status === "closed";
  const preApproval = ["registered", "pending_verification", "under_review"].includes(merchant.status);
  const categoryName = categories.find((c) => c.id === merchant.category_id)?.name;

  function startEdit() {
    setForm({
      business_name: merchant.business_name, category_id: merchant.category_id ?? "", location: merchant.location ?? "", city: merchant.city ?? "",
      sub_city: merchant.sub_city ?? "", woreda: merchant.woreda ?? "", landmark: merchant.landmark ?? "",
      phone: priv?.phone ?? "", email: priv?.email ?? "", owner_full_name: priv?.owner_full_name ?? "", owner_phone: priv?.owner_phone ?? "",
      owner_email: priv?.owner_email ?? "", business_registration_number: priv?.business_registration_number ?? "",
      store_name: store?.name ?? "", description: store?.description ?? "", pickup_address: store?.pickup_address ?? "",
      prep_time_minutes: store?.prep_time_minutes != null ? String(store.prep_time_minutes) : "", logo_url: store?.logo_url ?? "", banner_url: store?.banner_url ?? "",
    });
    setHours(store?.operating_hours ?? {});
    setEditing(true);
  }

  async function save() {
    if (!data) return;
    const orNull = (v: string) => (v.trim() === "" ? null : v.trim());
    const diff = (keys: string[], current: Record<string, unknown>, map: (k: string) => string = (k) => k) => {
      const out: Record<string, string | null> = {};
      for (const k of keys) {
        const next = orNull(form[k] ?? "");
        if (next !== (current[map(k)] == null ? null : String(current[map(k)]))) out[map(k)] = next;
      }
      return out;
    };
    const changes: Record<string, Record<string, unknown>> = {};
    const m = diff(["business_name", "category_id", "location", "city", "sub_city", "woreda", "landmark"], merchant);
    if (Object.keys(m).length) changes.merchant = m;
    const privKeys = ["email", "owner_full_name", "owner_email", ...(isAdmin ? ["phone", "owner_phone", "business_registration_number"] : [])];
    const p = diff(privKeys, priv ?? {});
    if (Object.keys(p).length) changes.private = p;
    if (store) {
      const s: Record<string, unknown> = diff(["store_name", "description", "pickup_address", "prep_time_minutes", "logo_url", "banner_url"], store, (k) => (k === "store_name" ? "name" : k));
      if (JSON.stringify(hours) !== JSON.stringify(store.operating_hours ?? {})) s.operating_hours = hours;
      if (Object.keys(s).length) changes.store = s;
    }
    if (Object.keys(changes).length === 0) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const { error } = await supabase.rpc("admin_update_merchant", { p_merchant_id: merchantId, p_changes: changes });
    setSaving(false);
    if (error) {
      toast.error(translateServerError(error.message, t));
      return;
    }
    toast.success(t("merchantDetail.saved"));
    setEditing(false);
    await load();
    onChanged?.();
  }

  async function saveTin(value: string) {
    const { error } = await supabase.rpc("set_merchant_tin", { p_merchant_id: merchantId, p_tin: value || null });
    if (error) {
      toast.error(translateServerError(error.message, t));
      return;
    }
    setTinEdit(null);
    toast.success(t("merchants.tinSaved"));
    await load();
  }

  // Suspend / reinstate (Merchants-page staff and admin) and approve / reject (admin tier only, enforced by the
  // review guard, migration 0093). The status itself goes through the normal merchants update.
  async function setStatus(status: string, reasonText?: string) {
    const payload: Record<string, unknown> = { status };
    if (status === "active") {
      payload.suspension_reason = null;
      if (preApproval) payload.approved_at = new Date().toISOString();
    }
    if (status === "suspended") payload.suspension_reason = reasonText || null;
    if (status === "rejected") payload.rejection_reason = reasonText || null;
    const { error } = await supabase.from("merchants").update(payload).eq("id", merchantId);
    setStatusReason(null);
    if (error) {
      toast.error(translateServerError(error.message, t));
      return;
    }
    await load();
    onChanged?.();
  }

  async function close() {
    setWorking(true);
    const { error } = await supabase.rpc("admin_close_merchant", { p_merchant_id: merchantId, p_reason: reason || null });
    setWorking(false);
    setDialog(null);
    if (error) {
      toast.error(translateServerError(error.message, t));
      return;
    }
    toast.success(t("merchantDetail.closed"));
    await load();
    onChanged?.();
  }

  async function reopen() {
    const { data: result, error } = await supabase.rpc("admin_reopen_merchant", { p_merchant_id: merchantId });
    if (error) {
      toast.error(translateServerError(error.message, t));
      return;
    }
    const r = result as { relisted_products: number; left_paused: number };
    toast.success(t("merchantDetail.reopened", { relisted: r.relisted_products, paused: r.left_paused }));
    await load();
    onChanged?.();
  }

  async function remove() {
    setWorking(true);
    const { data: files, error } = await supabase.rpc("admin_delete_merchant", { p_merchant_id: merchantId });
    setWorking(false);
    setDialog(null);
    if (error) {
      toast.error(translateServerError(error.message, t));
      return;
    }
    // The database cannot remove Storage files; do it here, best effort (a miss leaves an unreferenced file, nothing more).
    const f = files as { product_images: string[]; store_images: string[]; documents: string[] };
    const byBucket = new Map<string, string[]>();
    for (const url of [...f.product_images, ...f.store_images]) {
      const target = storageTarget(url);
      if (target) byBucket.set(target.bucket, [...(byBucket.get(target.bucket) ?? []), target.path]);
    }
    if (f.documents.length) byBucket.set("merchant-documents", [...(byBucket.get("merchant-documents") ?? []), ...f.documents]);
    await Promise.allSettled([...byBucket.entries()].map(([bucket, paths]) => supabase.storage.from(bucket).remove(paths)));
    toast.success(t("merchantDetail.deleted"));
    onDeleted?.();
  }

  const setField = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...form, [key]: e.target.value });

  return (
    <div>
      {closed && (
        <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/40 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
          {t("merchantDetail.closedBanner", { date: merchant.closed_at ? formatDateTime(merchant.closed_at) : "—" })}
          {merchant.close_reason ? ` ${merchant.close_reason}` : ""}
        </p>
      )}

      <Section title={t("merchantDetail.business")}>
        {editing ? (
          <div className="grid grid-cols-2 gap-2">
            <label className="col-span-2 text-xs text-gray-500 dark:text-gray-400">
              {t("merchantDetail.businessName")}
              <input value={form.business_name} onChange={setField("business_name")} className={inputClass} />
            </label>
            <label className="col-span-2 text-xs text-gray-500 dark:text-gray-400">
              {t("merchants.category")}
              <select value={form.category_id} onChange={setField("category_id")} className={inputClass}>
                <option value="">{t("merchants.categoryNotSet")}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            {(["city", "sub_city", "woreda", "landmark", "location"] as const).map((k) => (
              <label key={k} className="text-xs text-gray-500 dark:text-gray-400">
                {t(`merchantDetail.field.${k}`)}
                <input value={form[k]} onChange={setField(k)} className={inputClass} />
              </label>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("merchantDetail.businessName")}>{merchant.business_name}</Field>
            <Field label={t("common.status")}>
              <Badge variant={merchant.status === "active" ? "success" : merchant.status === "closed" || merchant.status === "rejected" ? "danger" : "warning"}>
                {t(`merchantStatus.${merchant.status}`)}
              </Badge>
            </Field>
            <Field label={t("merchants.category")}>{categoryName ?? t("merchants.categoryNotSet")}</Field>
            <Field label={t("merchantDetail.source")}>
              <Badge variant={merchant.source === "tolo_app" ? "info" : "default"}>
                {merchant.source === "tolo_app" ? t("merchants.source.tolo_app") : t("merchants.source.dashboard")}
              </Badge>
            </Field>
            <Field label={t("merchantDetail.address")}>{[merchant.landmark, merchant.sub_city, merchant.city, merchant.location].filter(Boolean).join(", ") || "—"}</Field>
            <Field label={t("customerDetail.created")}>{formatDateTime(merchant.created_at)}</Field>
          </div>
        )}
      </Section>

      <Section title={t("merchantDetail.ownerAndContact")}>
        {editing ? (
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["owner_full_name", false],
                ["owner_email", false],
                ["email", false],
                ["phone", true],
                ["owner_phone", true],
                ["business_registration_number", true],
              ] as const
            ).map(([k, adminOnly]) => (
              <label key={k} className="text-xs text-gray-500 dark:text-gray-400">
                {t(`merchantDetail.field.${k}`)}
                <input value={form[k]} onChange={setField(k)} disabled={adminOnly && !isAdmin} className={inputClass} />
              </label>
            ))}
            {!isAdmin && <p className="col-span-2 text-xs text-gray-500 dark:text-gray-400">{t("merchantDetail.sensitiveAdminOnly")}</p>}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("merchants.owner")}>{priv?.owner_full_name ?? data.owner?.full_name ?? "—"}</Field>
            <Field label={t("merchantDetail.field.owner_phone")}>{priv?.owner_phone ?? "—"}</Field>
            <Field label={t("merchantDetail.field.owner_email")}>{priv?.owner_email ?? "—"}</Field>
            <Field label={t("merchantDetail.field.phone")}>{priv?.phone ?? "—"}</Field>
            <Field label={t("merchantDetail.field.email")}>{priv?.email ?? "—"}</Field>
            <Field label={t("merchantDetail.field.business_registration_number")}>{priv?.business_registration_number ?? "—"}</Field>
          </div>
        )}
      </Section>

      {store && (
        <Section title={t("merchantDetail.store")}>
          {editing ? (
            <div className="space-y-2">
              <input value={form.store_name} onChange={setField("store_name")} aria-label={t("merchantDetail.storeName")} placeholder={t("merchantDetail.storeName")} className={inputClass} />
              <textarea value={form.description} onChange={setField("description")} rows={3} aria-label={t("common.description")} placeholder={t("common.description")} className={inputClass} />
              <input value={form.pickup_address} onChange={setField("pickup_address")} aria-label={t("merchantDetail.pickupAddress")} placeholder={t("merchantDetail.pickupAddress")} className={inputClass} />
              <input type="number" min={1} value={form.prep_time_minutes} onChange={setField("prep_time_minutes")} aria-label={t("merchantDetail.prepTime")} placeholder={t("merchantDetail.prepTime")} className={inputClass} />
              <input value={form.logo_url} onChange={setField("logo_url")} aria-label={t("merchantDetail.logoUrl")} placeholder={t("merchantDetail.logoUrl")} className={inputClass} />
              <input value={form.banner_url} onChange={setField("banner_url")} aria-label={t("merchantDetail.coverUrl")} placeholder={t("merchantDetail.coverUrl")} className={inputClass} />
              <div className="space-y-1.5 pt-1">
                {DAY_KEYS.map((day: DayKey) => {
                  const dayHours = hours[day];
                  const open = dayHours !== null && dayHours !== undefined;
                  return (
                    <div key={day} className="flex items-center gap-2 text-xs">
                      <label className="flex items-center gap-1.5 w-28 flex-shrink-0 dark:text-gray-300">
                        <input
                          type="checkbox"
                          checked={open}
                          onChange={(e) => setHours({ ...hours, [day]: e.target.checked ? { open: "08:00", close: "18:00" } : null })}
                        />
                        {t(`days.${day}`)}
                      </label>
                      {open ? (
                        <>
                          <input type="time" value={dayHours.open} onChange={(e) => setHours({ ...hours, [day]: { ...dayHours, open: e.target.value } })} className="border rounded-md px-2 py-1 dark:bg-navy dark:border-white/20 dark:text-gray-100" />
                          <span className="text-gray-400">{t("storeSettings.to")}</span>
                          <input type="time" value={dayHours.close} onChange={(e) => setHours({ ...hours, [day]: { ...dayHours, close: e.target.value } })} className="border rounded-md px-2 py-1 dark:bg-navy dark:border-white/20 dark:text-gray-100" />
                        </>
                      ) : (
                        <span className="text-gray-400">{t("storeSettings.closed")}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("merchantDetail.storeName")}>{store.name}</Field>
              <Field label={t("merchantDetail.pickupAddress")}>{store.pickup_address ?? "—"}</Field>
              <div className="col-span-2">
                <Field label={t("common.description")}>{store.description ?? "—"}</Field>
              </div>
              <Field label={t("merchantDetail.prepTime")}>{store.prep_time_minutes ?? "—"}</Field>
              <Field label={t("merchantDetail.hours")}>
                {store.operating_hours && Object.keys(store.operating_hours).length > 0
                  ? DAY_KEYS.map((d: DayKey) => `${t(`days.${d}`).slice(0, 3)} ${store.operating_hours?.[d] ? `${store.operating_hours[d]!.open}-${store.operating_hours[d]!.close}` : "—"}`).join(" · ")
                  : t("merchantDetail.noHours")}
              </Field>
              <div className="col-span-2 flex gap-3">
                {store.logo_url && <img src={store.logo_url} alt={t("merchantDetail.logoUrl")} className="h-16 w-16 object-cover rounded border dark:border-white/10" />}
                {store.banner_url && <img src={store.banner_url} alt={t("merchantDetail.coverUrl")} className="h-16 w-32 object-cover rounded border dark:border-white/10" />}
              </div>
            </div>
          )}
        </Section>
      )}

      <div className="flex gap-2 mb-5">
        {editing ? (
          <>
            <Button size="sm" onClick={save} disabled={saving || !form.business_name?.trim()}>
              {saving ? t("common.saving") : t("common.save")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
              {t("common.cancel")}
            </Button>
          </>
        ) : (
          <Button size="sm" variant="outline" onClick={startEdit}>
            {t("merchantDetail.edit")}
          </Button>
        )}
      </div>

      {isAdmin && (
        <Section title={t("merchants.tin")}>
          {tinEdit !== null ? (
            <div className="flex items-center gap-2 flex-wrap">
              <input
                value={tinEdit}
                onChange={(e) => setTinEdit(e.target.value.replace(/\D/g, "").slice(0, 10))}
                inputMode="numeric"
                maxLength={10}
                aria-label={t("merchants.tin")}
                className="border rounded-md px-2 py-1 text-sm font-mono w-40 bg-white dark:bg-navy dark:border-white/20 dark:text-gray-100"
              />
              <Button size="sm" onClick={() => saveTin(tinEdit)} disabled={tinEdit !== "" && tinEdit.length !== 10}>
                {t("common.save")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setTinEdit(null)}>
                {t("common.cancel")}
              </Button>
            </div>
          ) : (
            <div className="flex items-start gap-3 flex-wrap">
              <TinValue tin={data.tin} />
              <Button size="sm" variant="outline" onClick={() => setTinEdit(data.tin ?? "")}>
                {t("merchants.editTin")}
              </Button>
            </div>
          )}
        </Section>
      )}

      <Section title={t("merchantDetail.statusSection")}>
        <div className="flex gap-2 flex-wrap items-start">
          {/* Approve / reject: admin tier only (the database refuses staff too). */}
          {isAdmin && preApproval && (
            <>
              <Button size="sm" onClick={() => setStatus("active")}>
                {t("merchants.approve")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setStatusReason({ kind: "rejected", text: "" })}>
                {t("merchants.reject")}
              </Button>
            </>
          )}
          {merchant.status === "active" && (
            <Button size="sm" variant="outline" onClick={() => setStatusReason({ kind: "suspended", text: "" })}>
              {t("customers.suspend")}
            </Button>
          )}
          {merchant.status === "suspended" && (
            <Button size="sm" onClick={() => setStatus("active")}>
              {t("merchantDetail.reactivate")}
            </Button>
          )}
          {closed && (
            <Button size="sm" onClick={reopen}>
              {t("merchantDetail.reopen")}
            </Button>
          )}
        </div>
        {statusReason && (
          <div className="flex gap-2 mt-2">
            <input
              value={statusReason.text}
              onChange={(e) => setStatusReason({ ...statusReason, text: e.target.value })}
              placeholder={statusReason.kind === "rejected" ? t("merchants.reasonForRejection") : t("merchants.reasonForSuspension")}
              className={inputClass}
            />
            <Button size="sm" variant="destructive" onClick={() => setStatus(statusReason.kind, statusReason.text)}>
              {statusReason.kind === "rejected" ? t("merchants.confirmReject") : t("merchants.confirmSuspend")}
            </Button>
          </div>
        )}
        {merchant.suspension_reason && merchant.status === "suspended" && (
          <p className="text-xs text-orange-600 dark:text-orange-400 mt-1">{t("merchants.suspendedPrefix", { reason: merchant.suspension_reason })}</p>
        )}
        {merchant.rejection_reason && merchant.status === "rejected" && (
          <p className="text-xs text-red-600 dark:text-red-400 mt-1">{t("merchants.rejectedPrefix", { reason: merchant.rejection_reason })}</p>
        )}
      </Section>

      <Section title={t("merchantDetail.numbers")}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Field label={t("merchantDetail.products")}>{t("merchantDetail.productsValue", { total: data.products.total, published: data.products.published })}</Field>
          <Field label={t("merchantDetail.ordersLabel")}>{data.orders.total}</Field>
          <Field label={t("merchants.rating")}>{data.rating.count ? `${data.rating.avg} ★ (${data.rating.count})` : t("merchants.noReviews")}</Field>
          <Field label={t("merchantDetail.commission")}>{data.commission_rules.length ? data.commission_rules.map((r) => `${r.rate_percent}%`).join(", ") : t("merchantDetail.defaultCommission")}</Field>
        </div>
        {Object.keys(data.orders.by_status).length > 0 && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">{Object.entries(data.orders.by_status).map(([s, n]) => `${s}: ${n}`).join(" · ")}</p>
        )}
      </Section>

      {isAdmin && (
        <Section title={t("merchantDetail.payouts")}>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t("merchantDetail.noBankDetails")}</p>
          {data.wallet_balance !== null && <p className="text-sm dark:text-gray-100 mb-1">{t("merchantDetail.walletBalance", { amount: formatCurrency(Number(data.wallet_balance)) })}</p>}
          {data.payouts.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">{t("customerDetail.none")}</p>
          ) : (
            <ul className="divide-y dark:divide-white/10 text-sm">
              {data.payouts.map((p) => (
                <li key={p.id} className="py-1.5 flex justify-between gap-2">
                  <span className="dark:text-gray-100">{formatDateTime(p.created_at)}</span>
                  <span className="text-gray-600 dark:text-gray-300">
                    {formatCurrency(Number(p.total_amount))} · {p.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {isAdmin && (
        <Section title={t("merchantDetail.applications")}>
          {data.applications.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">{t("customerDetail.none")}</p>
          ) : (
            <ul className="text-sm space-y-1 dark:text-gray-100">
              {data.applications.map((a) => (
                <li key={a.id}>
                  {t(`applicationStatus.${a.status}`)} · {formatDateTime(a.created_at)}
                  {a.admin_note ? ` · ${a.admin_note}` : ""}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      <Section title={t("merchants.documents")}>
        {data.documents.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">{t("merchants.noDocumentsUploaded")}</p>
        ) : (
          <ul className="text-sm space-y-1 dark:text-gray-100">
            {data.documents.map((d) => (
              <li key={d.id}>
                {d.doc_type} · {d.file_name ?? "—"} · {d.status}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t("customerDetail.audit")}>
        {data.audit.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">{t("customerDetail.none")}</p>
        ) : (
          <ul className="space-y-1.5 text-xs text-gray-600 dark:text-gray-300">
            {data.audit.map((l) => (
              <li key={l.id}>
                <span className="font-medium dark:text-gray-100">
                  {l.action} · {l.actor ?? "—"}
                </span>{" "}
                · {formatDateTime(l.created_at)}
                {auditSummary(l) && <span className="block text-gray-500 dark:text-gray-400">{auditSummary(l)}</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {isAdmin && (
        <Section title={t("customerDetail.dangerZone")}>
          <div className="space-y-3">
            {!closed && (
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t("merchantDetail.closeExplain")}</p>
                <Button size="sm" variant="destructive" onClick={() => { setReason(""); setDialog("close"); }}>
                  {t("merchantDetail.close")}
                </Button>
              </div>
            )}
            {data.can_hard_delete ? (
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t("merchantDetail.deleteExplain")}</p>
                <Button size="sm" variant="destructive" onClick={() => setDialog("delete")}>
                  {t("merchantDetail.delete")}
                </Button>
              </div>
            ) : (
              <p className="text-xs text-gray-500 dark:text-gray-400">{t("merchantDetail.cannotDelete")}</p>
            )}
          </div>
        </Section>
      )}

      <ConfirmDialog
        open={dialog === "close"}
        title={t("merchantDetail.closeTitle", { name: merchant.business_name })}
        message={
          <div className="space-y-2">
            <p>{data.active_orders > 0 ? t("merchantDetail.closeBlocked", { count: data.active_orders }) : t("merchantDetail.closeMessage")}</p>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("merchantDetail.closeReason")} className={inputClass} />
          </div>
        }
        confirmLabel={t("merchantDetail.close")}
        busyLabel={t("merchantDetail.closing")}
        busy={working}
        requireText={merchant.business_name}
        requireTextLabel={t("merchantDetail.typeName", { name: merchant.business_name })}
        onConfirm={close}
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === "delete"}
        title={t("merchantDetail.deleteTitle", { name: merchant.business_name })}
        message={t("merchantDetail.deleteMessage")}
        confirmLabel={t("merchantDetail.delete")}
        busyLabel={t("merchantDetail.deleting")}
        busy={working}
        requireText={merchant.business_name}
        requireTextLabel={t("merchantDetail.typeName", { name: merchant.business_name })}
        onConfirm={remove}
        onCancel={() => setDialog(null)}
      />
    </div>
  );
}
