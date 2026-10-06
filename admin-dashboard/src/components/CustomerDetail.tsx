import { useEffect, useState, type ReactNode } from "react";
import { Badge, Button, ConfirmDialog, SkeletonRows, formatCurrency, formatDateTime, toast, translateServerError, useTranslation } from "@tolo/ui";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";

interface AddressRow {
  id: string;
  label: string | null;
  recipient_name: string;
  phone: string | null;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  landmark: string | null;
  sub_city: string | null;
}

interface AuditRow {
  id: string;
  action: string;
  entity_type: string;
  created_at: string;
  actor: string | null;
  metadata: { before?: Record<string, unknown>; after?: Record<string, unknown> } & Record<string, unknown>;
}

export interface CustomerDetailData {
  profile: {
    id: string;
    full_name: string | null;
    phone: string | null;
    account_status: string;
    suspension_reason: string | null;
    created_at: string;
    anonymized_at: string | null;
    referral_code: string | null;
  };
  email: string | null;
  last_sign_in_at: string | null;
  tolo_linked: boolean;
  tolo_phone: string | null;
  addresses: AddressRow[];
  orders: { id: string; order_number: number | null; total: number; payment_status: string; created_at: string; statuses: string[] }[];
  order_count: number;
  paid_total: number;
  refunds: { id: string; amount: number; status: string; created_at: string; reason: string }[];
  reviews: { id: string; rating: number; comment: string | null; created_at: string }[];
  cart_items: number;
  favorites: number;
  audit: AuditRow[];
}

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
  const after = row.metadata?.after;
  const before = row.metadata?.before;
  if (!after) return "";
  return Object.keys(after)
    .map((key) => `${key}: ${before && key in before ? String(before[key] ?? "—") : "—"} → ${String(after[key] ?? "—")}`)
    .join("; ");
}

/** Everything about one customer, for an admin: profile, addresses, orders, refunds, reviews, cart, audit trail.
 * Reads through admin_customer_detail() and writes through admin_update_customer(), admin_update_customer_address()
 * and admin_anonymize_customer() (migration 0099), which enforce who may do what. The buttons for what a member of
 * staff may not do (change a phone, delete the customer) are not rendered for them; the database refuses them anyway. */
export function CustomerDetail({ customerId, onChanged }: { customerId: string; onChanged?: () => void }) {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();
  const [data, setData] = useState<CustomerDetailData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ full_name: "", email: "", phone: "" });
  const [saving, setSaving] = useState(false);
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [addressForm, setAddressForm] = useState<Record<string, string>>({});
  const [suspendReason, setSuspendReason] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    const { data: detail, error } = await supabase.rpc("admin_customer_detail", { p_customer_id: customerId });
    if (error || !detail) {
      setLoadError(true);
      return;
    }
    setLoadError(false);
    setData(detail as CustomerDetailData);
  }

  useEffect(() => {
    setData(null);
    setEditing(false);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  if (loadError) return <p className="text-sm text-red-600 dark:text-red-400">{t("customerDetail.loadError")}</p>;
  if (!data) return <SkeletonRows count={6} />;

  const { profile } = data;
  const deleted = profile.anonymized_at !== null;

  function startEdit() {
    setForm({ full_name: profile.full_name ?? "", email: data?.email ?? "", phone: profile.phone ?? "" });
    setEditing(true);
  }

  async function saveProfile() {
    if (!data) return;
    const changes: Record<string, string> = {};
    if (form.full_name.trim() !== (profile.full_name ?? "")) changes.full_name = form.full_name.trim();
    if (form.email.trim().toLowerCase() !== (data.email ?? "").toLowerCase()) changes.email = form.email.trim();
    if (isAdmin && form.phone.trim() !== (profile.phone ?? "")) changes.phone = form.phone.trim();
    if (Object.keys(changes).length === 0) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const { error } = await supabase.rpc("admin_update_customer", { p_customer_id: customerId, p_changes: changes });
    setSaving(false);
    if (error) {
      toast.error(translateServerError(error.message, t));
      return;
    }
    toast.success(t("customerDetail.saved"));
    setEditing(false);
    await load();
    onChanged?.();
  }

  function startEditAddress(a: AddressRow) {
    setEditingAddressId(a.id);
    setAddressForm({
      label: a.label ?? "", recipient_name: a.recipient_name, phone: a.phone ?? "", line1: a.line1, line2: a.line2 ?? "",
      city: a.city, region: a.region ?? "", landmark: a.landmark ?? "", sub_city: a.sub_city ?? "",
    });
  }

  async function saveAddress(a: AddressRow) {
    const changes: Record<string, string> = {};
    for (const [key, value] of Object.entries(addressForm)) {
      if (key === "phone" && !isAdmin) continue;
      if (value.trim() !== ((a as unknown as Record<string, string | null>)[key] ?? "")) changes[key] = value.trim();
    }
    if (Object.keys(changes).length === 0) {
      setEditingAddressId(null);
      return;
    }
    setSaving(true);
    const { error } = await supabase.rpc("admin_update_customer_address", { p_address_id: a.id, p_changes: changes });
    setSaving(false);
    if (error) {
      toast.error(translateServerError(error.message, t));
      return;
    }
    toast.success(t("customerDetail.saved"));
    setEditingAddressId(null);
    await load();
  }

  async function setStatus(status: "active" | "suspended", reason: string | null) {
    const { error } = await supabase
      .from("profiles")
      .update({ account_status: status, suspension_reason: status === "suspended" ? reason : null })
      .eq("id", customerId);
    if (error) {
      toast.error(translateServerError(error.message, t));
      return;
    }
    setSuspendReason(null);
    await load();
    onChanged?.();
  }

  async function anonymize() {
    setDeleting(true);
    const { error } = await supabase.rpc("admin_anonymize_customer", { p_customer_id: customerId });
    setDeleting(false);
    setConfirmDelete(false);
    if (error) {
      toast.error(translateServerError(error.message, t));
      return;
    }
    toast.success(t("customerDetail.deleted"));
    await load();
    onChanged?.();
  }

  return (
    <div>
      {deleted && (
        <p className="mb-4 rounded-md border border-red-300 bg-red-50 dark:bg-red-500/10 dark:border-red-500/40 px-3 py-2 text-sm text-red-800 dark:text-red-200">
          {t("customerDetail.deletedBanner", { date: formatDateTime(profile.anonymized_at!) })}
        </p>
      )}

      <Section title={t("customerDetail.profile")}>
        {editing ? (
          <div className="space-y-2">
            <label className="block text-xs text-gray-500 dark:text-gray-400">
              {t("common.name")}
              <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className={inputClass} />
            </label>
            <label className="block text-xs text-gray-500 dark:text-gray-400">
              {t("customerDetail.email")}
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputClass} />
            </label>
            <label className="block text-xs text-gray-500 dark:text-gray-400">
              {t("common.phone")}
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} disabled={!isAdmin} className={inputClass} />
            </label>
            {isAdmin ? (
              <p className="text-xs text-amber-700 dark:text-amber-300">{t("customerDetail.phoneWarning")}</p>
            ) : (
              <p className="text-xs text-gray-500 dark:text-gray-400">{t("customerDetail.phoneAdminOnly")}</p>
            )}
            <div className="flex gap-2">
              <Button size="sm" onClick={saveProfile} disabled={saving || !form.full_name.trim()}>
                {saving ? t("common.saving") : t("common.save")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("common.name")}>{profile.full_name ?? "—"}</Field>
              <Field label={t("common.status")}>
                <Badge variant={profile.account_status === "active" ? "success" : "danger"}>
                  {profile.account_status === "active" ? t("common.active") : t("customerDetail.disabled")}
                </Badge>
                {profile.suspension_reason && <span className="block text-xs text-gray-500 dark:text-gray-400">{profile.suspension_reason}</span>}
              </Field>
              <Field label={t("common.phone")}>{profile.phone ?? "—"}</Field>
              <Field label={t("customerDetail.email")}>{data.email ?? "—"}</Field>
              <Field label={t("customerDetail.created")}>{formatDateTime(profile.created_at)}</Field>
              <Field label={t("customerDetail.lastActive")}>{data.last_sign_in_at ? formatDateTime(data.last_sign_in_at) : "—"}</Field>
              <Field label={t("customerDetail.toloLink")}>
                {data.tolo_linked ? `${t("customerDetail.linked")}${data.tolo_phone ? ` · ${data.tolo_phone}` : ""}` : t("customerDetail.notLinked")}
              </Field>
            </div>
            {!deleted && (
              <div className="flex gap-2 mt-3 flex-wrap">
                <Button size="sm" variant="outline" onClick={startEdit}>
                  {t("customerDetail.edit")}
                </Button>
                {profile.account_status === "active" ? (
                  suspendReason === null ? (
                    <Button size="sm" variant="outline" onClick={() => setSuspendReason("")}>
                      {t("customerDetail.disable")}
                    </Button>
                  ) : (
                    <div className="flex gap-2 flex-1 min-w-[16rem]">
                      <input
                        value={suspendReason}
                        onChange={(e) => setSuspendReason(e.target.value)}
                        placeholder={t("customerDetail.disableReason")}
                        className={inputClass}
                      />
                      <Button size="sm" variant="destructive" onClick={() => setStatus("suspended", suspendReason || null)}>
                        {t("customerDetail.confirmDisable")}
                      </Button>
                    </div>
                  )
                ) : (
                  <Button size="sm" onClick={() => setStatus("active", null)}>
                    {t("customerDetail.enable")}
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </Section>

      <Section title={t("customerDetail.addresses", { count: data.addresses.length })}>
        {data.addresses.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">{t("customerDetail.none")}</p>
        ) : (
          <ul className="space-y-2">
            {data.addresses.map((a) => (
              <li key={a.id} className="border rounded-md p-2 dark:border-white/10">
                {editingAddressId === a.id ? (
                  <div className="grid grid-cols-2 gap-2">
                    {(["label", "recipient_name", "phone", "line1", "line2", "city", "region", "landmark", "sub_city"] as const).map((key) => (
                      <input
                        key={key}
                        value={addressForm[key] ?? ""}
                        onChange={(e) => setAddressForm({ ...addressForm, [key]: e.target.value })}
                        disabled={key === "phone" && !isAdmin}
                        placeholder={t(`customerDetail.address.${key}`)}
                        aria-label={t(`customerDetail.address.${key}`)}
                        className={inputClass}
                      />
                    ))}
                    <div className="col-span-2 flex gap-2">
                      <Button size="sm" onClick={() => saveAddress(a)} disabled={saving}>
                        {t("common.save")}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingAddressId(null)}>
                        {t("common.cancel")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-between gap-2">
                    <div className="text-sm dark:text-gray-100">
                      <p className="font-medium">
                        {a.recipient_name}
                        {a.label ? ` · ${a.label}` : ""}
                      </p>
                      <p className="text-gray-600 dark:text-gray-300">
                        {[a.line1, a.line2, a.sub_city, a.city, a.region].filter(Boolean).join(", ")}
                      </p>
                      {a.phone && <p className="text-xs text-gray-500 dark:text-gray-400">{a.phone}</p>}
                    </div>
                    {!deleted && (
                      <Button size="sm" variant="outline" onClick={() => startEditAddress(a)}>
                        {t("customerDetail.edit")}
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t("customerDetail.orders", { count: data.order_count })}>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{t("customerDetail.paidTotal", { amount: formatCurrency(Number(data.paid_total)) })}</p>
        {data.orders.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">{t("customerDetail.none")}</p>
        ) : (
          <ul className="divide-y dark:divide-white/10 text-sm">
            {data.orders.map((o) => (
              <li key={o.id} className="py-1.5 flex justify-between gap-2 flex-wrap">
                <span className="dark:text-gray-100">
                  #{o.order_number ?? o.id.slice(0, 8)} · {formatDateTime(o.created_at)}
                </span>
                <span className="text-gray-600 dark:text-gray-300">
                  {formatCurrency(Number(o.total))} · {o.payment_status} · {o.statuses.join(", ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t("customerDetail.refunds", { count: data.refunds.length })}>
        {data.refunds.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">{t("customerDetail.none")}</p>
        ) : (
          <ul className="divide-y dark:divide-white/10 text-sm">
            {data.refunds.map((r) => (
              <li key={r.id} className="py-1.5 flex justify-between gap-2">
                <span className="dark:text-gray-100">{r.reason}</span>
                <span className="text-gray-600 dark:text-gray-300">
                  {formatCurrency(Number(r.amount))} · {r.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t("customerDetail.reviews", { count: data.reviews.length })}>
        {data.reviews.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">{t("customerDetail.none")}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.reviews.map((r) => (
              <li key={r.id} className="dark:text-gray-100">
                {"★".repeat(r.rating)}
                {r.comment ? ` ${r.comment}` : ""}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
          {t("customerDetail.cartAndFavorites", { cart: data.cart_items, favorites: data.favorites })}
        </p>
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

      {isAdmin && !deleted && (
        <Section title={t("customerDetail.dangerZone")}>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{t("customerDetail.deleteExplain")}</p>
          <Button size="sm" variant="destructive" onClick={() => setConfirmDelete(true)}>
            {t("customerDetail.delete")}
          </Button>
        </Section>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={t("customerDetail.deleteTitle", { name: profile.full_name ?? t("customers.unnamed") })}
        message={t("customerDetail.deleteMessage")}
        confirmLabel={t("customerDetail.delete")}
        busyLabel={t("customerDetail.deleting")}
        busy={deleting}
        requireText="DELETE"
        requireTextLabel={t("customerDetail.typeDelete")}
        onConfirm={anonymize}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
