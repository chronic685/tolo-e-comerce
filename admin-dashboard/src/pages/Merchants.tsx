import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { exportToCsv } from "../lib/csvExport";
import { ADMIN_PAGE_SIZE, Badge, Button, DataTable, ExportCsvButton, fetchAllRows, Pagination, Sheet, SkeletonRows, toast, totalPagesFor, translateServerError, usePagination, useTranslation, type DataTableColumn, type FetchPageResult } from "@tolo/ui";
import { useAuth } from "../lib/AuthContext";
import { TinValue } from "../components/TinValue";
import { MerchantDetail } from "../components/MerchantDetail";
import type { Category, Merchant, MerchantDocument, MerchantPrivate } from "../types";
import { ApplicationsPanel } from "./MerchantApplications";

const STATUS_FILTERS = ["all", "registered", "under_review", "active", "suspended", "rejected", "closed"];

const MERCHANT_STATUS_KEYS: Record<string, string> = {
  all: "merchantStatus.all",
  registered: "merchantStatus.registered",
  pending_verification: "merchantStatus.pending_verification",
  under_review: "merchantStatus.under_review",
  active: "merchantStatus.active",
  suspended: "merchantStatus.suspended",
  rejected: "merchantStatus.rejected",
  closed: "merchantStatus.closed",
};

const DOC_STATUS_KEYS: Record<string, string> = {
  uploaded: "docStatus.uploaded",
  under_review: "docStatus.under_review",
  verified: "docStatus.verified",
  rejected: "docStatus.rejected",
};

const statusVariant: Record<string, "warning" | "info" | "success" | "danger" | "default"> = {
  registered: "warning",
  pending_verification: "warning",
  under_review: "info",
  approved: "info",
  active: "success",
  suspended: "warning",
  rejected: "danger",
  closed: "default",
};

const docStatusVariant: Record<string, "default" | "info" | "success" | "danger"> = {
  uploaded: "default",
  under_review: "info",
  verified: "success",
  rejected: "danger",
};

const TABS = ["merchants", "applications"] as const;
type TabKey = (typeof TABS)[number];

/** One page for both ways a merchant gets onboarded: people who signed up in the merchant dashboard (the
 * Merchants tab) and applications from the Tolo app (the Applications tab, with a pending count). Every
 * merchant carries a source label either way. Only admin tier sees or can use the Applications tab. */
export function Merchants() {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: TabKey = isAdmin && searchParams.get("tab") === "applications" ? "applications" : "merchants";
  const [pendingCount, setPendingCount] = useState<number | null>(null);

  async function loadPendingCount() {
    if (!isAdmin) return;
    const { count } = await supabase.from("merchant_applications").select("id", { count: "exact", head: true }).eq("status", "pending");
    setPendingCount(count ?? 0);
  }

  useEffect(() => {
    loadPendingCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  function setTab(next: TabKey) {
    setSearchParams(next === "merchants" ? {} : { tab: next });
  }

  return (
    <div>
      <h1 className="text-xl font-bold mb-4 dark:text-gray-100">{t("merchants.title")}</h1>
      {isAdmin && (
        <div className="flex items-center gap-1 border-b dark:border-white/10 mb-4">
          {TABS.map((key) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-2 ${
                tab === key
                  ? "border-navy dark:border-navy-light text-navy dark:text-navy-light"
                  : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              }`}
            >
              {key === "merchants" ? t("merchants.tabMerchants") : t("merchantApplications.title")}
              {key === "applications" && pendingCount !== null && pendingCount > 0 && (
                <span
                  className="min-w-5 h-5 px-1.5 rounded-full bg-amber-500 text-white text-[11px] leading-5 text-center font-semibold"
                  title={t("merchants.pendingApplications", { count: pendingCount })}
                  aria-label={t("merchants.pendingApplications", { count: pendingCount })}
                >
                  {pendingCount}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {tab === "applications" ? <ApplicationsPanel onReviewed={loadPendingCount} /> : <MerchantList />}
    </div>
  );
}

// Contact details come from merchant_private; while the old columns still exist on the row (before migration 0099, or between 0099 and 0100)
// they are the fallback, so the page works at every stage of the rollout.
function privOf(m: Merchant): Partial<MerchantPrivate> {
  const p = m.merchant_private;
  const embedded = Array.isArray(p) ? p[0] : p;
  if (embedded) return embedded;
  return { phone: m.phone, email: m.email, owner_full_name: m.owner_full_name, owner_phone: m.owner_phone, owner_email: m.owner_email };
}

const MERCHANT_SELECT = "*, categories ( name ), merchant_tins ( tin ), merchant_private ( phone, email, owner_full_name, owner_phone, owner_email )";
// Without the contact embed, for a database where merchant_private does not exist yet (before 0099): the old columns come with "*".
const MERCHANT_SELECT_LEGACY = "*, categories ( name ), merchant_tins ( tin )";

function tinOf(m: Merchant): string | null {
  const t = m.merchant_tins;
  return (Array.isArray(t) ? t[0]?.tin : t?.tin) ?? null;
}

function MerchantList() {
  const { t } = useTranslation();
  const { user, isAdmin } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const statusFilter = searchParams.get("status") ?? "all";
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const { page, from, to, setPage } = usePagination({ pageSize: ADMIN_PAGE_SIZE, resetKey: statusFilter });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<MerchantDocument[]>([]);
  const [performance, setPerformance] = useState<{
    acceptance_rate: number | null;
    cancellation_rate: number | null;
    avg_prep_minutes: number | null;
    avg_rating: number | null;
    review_count: number;
  } | null>(null);
  const [docLinks, setDocLinks] = useState<Record<string, string>>({});
  const [reasonPromptId, setReasonPromptId] = useState<string | null>(null);
  const [reasonPromptKind, setReasonPromptKind] = useState<"rejected" | "suspended" | null>(null);
  const [reason, setReason] = useState("");
  const [categories, setCategories] = useState<Pick<Category, "id" | "name">[]>([]);

  useEffect(() => {
    supabase.from("categories").select("id, name").order("name").then(({ data }) => setCategories(data ?? []));
  }, []);

  const [tinEdit, setTinEdit] = useState<{ id: string; value: string } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  // Admin tier sets, changes or clears a merchant's TIN (set_merchant_tin, migration 0094), which also
  // enforces the format and that no other merchant or pending application holds it.
  async function saveTin(m: Merchant, value: string) {
    const { error } = await supabase.rpc("set_merchant_tin", { p_merchant_id: m.id, p_tin: value || null });
    if (error) {
      toast.error(translateServerError(error.message, t));
      return;
    }
    setMerchants((prev) => prev.map((x) => (x.id === m.id ? { ...x, merchant_tins: value ? { tin: value } : null } : x)));
    setTinEdit(null);
    toast.success(t("merchants.tinSaved"));
  }

  // An admin confirming (or correcting) a merchant's category, e.g. one whose old
  // free-text value had no exact match. Writes the link only; the legacy text stays.
  async function setCategory(m: Merchant, categoryId: string) {
    const { error } = await supabase.from("merchants").update({ category_id: categoryId || null }).eq("id", m.id);
    if (error) return;
    const name = categories.find((c) => c.id === categoryId)?.name;
    setMerchants((prev) => prev.map((x) => (x.id === m.id ? { ...x, category_id: categoryId || null, categories: name ? { name } : null } : x)));
  }

  async function load() {
    setLoading(true);
    const page = (select: string) => {
      let query = supabase.from("merchants").select(select, { count: "exact" }).order("created_at", { ascending: false });
      if (statusFilter !== "all") query = query.eq("status", statusFilter);
      return query.range(from, to);
    };
    let result = await page(MERCHANT_SELECT);
    if (result.error) result = await page(MERCHANT_SELECT_LEGACY);
    const { data, count } = result;
    setMerchants((data as unknown as Merchant[]) ?? []);
    setTotalCount(count ?? 0);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, from, to]);

  async function updateStatus(m: Merchant, status: string, reasonText?: string) {
    const payload: Record<string, unknown> = { status };
    if (status === "active" && user) {
      payload.approved_at = new Date().toISOString();
      payload.approved_by = user.id;
    }
    if (status === "rejected") payload.rejection_reason = reasonText ?? null;
    if (status === "suspended") payload.suspension_reason = reasonText ?? null;
    const { error } = await supabase.from("merchants").update(payload).eq("id", m.id);
    setReasonPromptId(null);
    setReason("");
    if (error) return;
    // Was `await load()` -- setLoading(true) inside it wipes the whole list
    // to "Loading..." for what should be one row's status changing. The
    // list is also filtered by status (the STATUS_FILTERS tabs), so a
    // merchant that no longer matches the active filter (e.g. approved
    // while viewing "registered") is removed rather than left showing the
    // wrong status under the wrong tab.
    const leavesFilteredView = statusFilter !== "all" && status !== statusFilter;
    setMerchants((prev) =>
      leavesFilteredView
        ? prev.filter((merchant) => merchant.id !== m.id)
        : prev.map((merchant) => (merchant.id === m.id ? { ...merchant, ...payload, status } : merchant)),
    );
    if (leavesFilteredView) setTotalCount((prev) => Math.max(0, prev - 1));
  }

  // Group 3, item 12: fetched lazily on expand, not for every row on the
  // paginated list -- each metric is its own computed-column function
  // (migration 0063), one aggregate subquery per row otherwise.
  async function toggleExpand(m: Merchant) {
    if (expandedId === m.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(m.id);
    const [{ data: docs }, { data: perf }] = await Promise.all([
      supabase.from("merchant_documents").select("*").eq("merchant_id", m.id),
      supabase
        .from("merchants")
        .select(
          "acceptance_rate:merchant_acceptance_rate, cancellation_rate:merchant_cancellation_rate, avg_prep_minutes:merchant_avg_prep_minutes, avg_rating:merchants_avg_rating, review_count:merchants_review_count",
        )
        .eq("id", m.id)
        .single(),
    ]);
    setDocuments(docs ?? []);
    setPerformance(perf ?? null);
  }

  async function openDocument(doc: MerchantDocument) {
    if (docLinks[doc.id]) {
      window.open(docLinks[doc.id], "_blank");
      return;
    }
    const { data, error } = await supabase.storage.from("merchant-documents").createSignedUrl(doc.file_url, 300);
    if (error || !data) return;
    setDocLinks((prev) => ({ ...prev, [doc.id]: data.signedUrl }));
    window.open(data.signedUrl, "_blank");
  }

  async function setDocStatus(doc: MerchantDocument, status: string) {
    await supabase
      .from("merchant_documents")
      .update({ status, verified_by: user?.id, verification_date: new Date().toISOString() })
      .eq("id", doc.id);
    setDocuments((prev) => prev.map((d) => (d.id === doc.id ? { ...d, status } : d)));
  }

  // Exports every merchant matching the current status filter, not just
  // the page on screen.
  async function handleExport() {
    const probe = await supabase.from("merchants").select(MERCHANT_SELECT).limit(1);
    const exportSelect = probe.error ? MERCHANT_SELECT_LEGACY : MERCHANT_SELECT;
    const rows = await fetchAllRows<Merchant>((from, to) => {
      let query = supabase.from("merchants").select(exportSelect).order("created_at", { ascending: false });
      if (statusFilter !== "all") query = query.eq("status", statusFilter);
      return query.range(from, to) as unknown as PromiseLike<FetchPageResult<Merchant>>;
    });
    exportToCsv(
      `merchants-${statusFilter}-${new Date().toISOString().slice(0, 10)}.csv`,
      rows.map((m) => ({
        id: m.id,
        business_name: m.business_name,
        category: m.categories?.name ?? m.business_category ?? "",
        source: m.source,
        tin: tinOf(m) ?? "",
        subcategory: m.business_subcategory ?? "",
        phone: privOf(m).phone ?? "",
        email: privOf(m).email ?? "",
        city: m.city ?? "",
        sub_city: m.sub_city ?? "",
        status: m.status,
        owner_full_name: privOf(m).owner_full_name ?? "",
        owner_phone: privOf(m).owner_phone ?? "",
        created_at: m.created_at,
      })),
    );
  }

  const columns: DataTableColumn<Merchant>[] = [
    {
      key: "business",
      header: t("merchants.column"),
      render: (m) => (
        <div>
          <button className="text-left" onClick={() => toggleExpand(m)}>
            <p className="font-medium text-sm hover:text-navy dark:hover:text-navy-light flex items-center gap-1.5 flex-wrap">
              {m.business_name}
              <Badge variant={m.source === "tolo_app" ? "info" : "default"}>
                {m.source === "tolo_app" ? t("merchants.source.tolo_app") : t("merchants.source.dashboard")}
              </Badge>
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {m.categories?.name ?? (m.business_category ? t("merchants.legacyCategory", { name: m.business_category }) : t("merchants.categoryNotSet"))} ·{" "}
              {[m.city, m.sub_city].filter(Boolean).join(", ") || m.location || "—"}
            </p>
            {m.status === "rejected" && m.rejection_reason && (
              <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">{t("merchants.rejectedPrefix", { reason: m.rejection_reason })}</p>
            )}
            {m.status === "suspended" && m.suspension_reason && (
              <p className="text-xs text-orange-600 dark:text-orange-400 mt-0.5">{t("merchants.suspendedPrefix", { reason: m.suspension_reason })}</p>
            )}
          </button>

          {reasonPromptId === m.id && reasonPromptKind && (
            <div className="pt-2 flex gap-2">
              <input
                placeholder={reasonPromptKind === "rejected" ? t("merchants.reasonForRejection") : t("merchants.reasonForSuspension")}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="flex-1 border rounded-md px-3 py-1.5 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
              />
              <Button size="sm" variant="destructive" onClick={() => updateStatus(m, reasonPromptKind, reason || undefined)}>
                {reasonPromptKind === "rejected" ? t("merchants.confirmReject") : t("merchants.confirmSuspend")}
              </Button>
            </div>
          )}

          {expandedId === m.id && (
            <div className="bg-gray-50 dark:bg-white/5 -mx-3 px-3 mt-3 py-3 text-sm border-t dark:border-white/10">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("merchants.owner")}</p>
              <p className="mb-3">
                {privOf(m).owner_full_name ?? "—"} · {privOf(m).owner_phone ?? "—"} · {privOf(m).owner_email ?? privOf(m).email ?? "—"}
              </p>

              <label className="block mb-3">
                <span className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("merchants.category")}</span>
                <select
                  value={m.category_id ?? ""}
                  onChange={(e) => setCategory(m, e.target.value)}
                  className="border rounded-md px-2 py-1 text-sm bg-white dark:bg-navy-dark dark:border-white/20 dark:text-gray-100 max-w-full"
                >
                  <option value="">{t("merchants.categoryNotSet")}</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>

              {isAdmin && (
                <div className="mb-3">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("merchants.tin")}</p>
                  {tinEdit?.id === m.id ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <input
                        value={tinEdit.value}
                        onChange={(e) => setTinEdit({ id: m.id, value: e.target.value.replace(/\D/g, "").slice(0, 10) })}
                        inputMode="numeric"
                        maxLength={10}
                        placeholder="0000000000"
                        aria-label={t("merchants.tin")}
                        className="border rounded-md px-2 py-1 text-sm font-mono w-40 bg-white dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
                      />
                      <Button size="sm" onClick={() => saveTin(m, tinEdit.value)} disabled={tinEdit.value !== "" && tinEdit.value.length !== 10}>
                        {t("common.save")}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setTinEdit(null)}>
                        {t("common.cancel")}
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3 flex-wrap">
                      <TinValue tin={tinOf(m)} />
                      <Button size="sm" variant="outline" onClick={() => setTinEdit({ id: m.id, value: tinOf(m) ?? "" })}>
                        {t("merchants.editTin")}
                      </Button>
                    </div>
                  )}
                </div>
              )}

              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("merchants.performance")}</p>
              {performance ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                  <div className="bg-white dark:bg-navy-dark border dark:border-white/10 rounded-md px-3 py-2">
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("merchants.acceptanceRate")}</p>
                    <p className="text-sm font-semibold">{performance.acceptance_rate != null ? `${performance.acceptance_rate}%` : "—"}</p>
                  </div>
                  <div className="bg-white dark:bg-navy-dark border dark:border-white/10 rounded-md px-3 py-2">
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("merchants.cancellationRate")}</p>
                    <p className="text-sm font-semibold">{performance.cancellation_rate != null ? `${performance.cancellation_rate}%` : "—"}</p>
                  </div>
                  <div className="bg-white dark:bg-navy-dark border dark:border-white/10 rounded-md px-3 py-2">
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("merchants.avgPrepTime")}</p>
                    <p className="text-sm font-semibold">{performance.avg_prep_minutes != null ? `${performance.avg_prep_minutes} min` : "—"}</p>
                  </div>
                  <div className="bg-white dark:bg-navy-dark border dark:border-white/10 rounded-md px-3 py-2">
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("merchants.rating")}</p>
                    <p className="text-sm font-semibold">
                      {performance.avg_rating != null ? `${performance.avg_rating} ★ (${performance.review_count})` : t("merchants.noReviews")}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-gray-500 dark:text-gray-400 text-xs mb-3">{t("merchants.loadingEllipsis")}</p>
              )}

              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("merchants.documents")}</p>
              {documents.length === 0 ? (
                <p className="text-gray-500 dark:text-gray-400 text-xs">{t("merchants.noDocumentsUploaded")}</p>
              ) : (
                <div className="space-y-1.5">
                  {documents.map((doc) => (
                    <div key={doc.id} className="flex items-center justify-between bg-white dark:bg-navy-dark border dark:border-white/10 rounded-md px-3 py-1.5">
                      <button onClick={() => openDocument(doc)} className="text-left hover:text-navy dark:hover:text-navy-light">
                        <span className="capitalize">{doc.doc_type.replace(/_/g, " ")}</span>
                        {doc.file_name && <span className="text-gray-400 dark:text-gray-500"> — {doc.file_name}</span>}
                      </button>
                      <div className="flex items-center gap-2">
                        <Badge variant={docStatusVariant[doc.status] ?? "default"} className="capitalize">
                          {DOC_STATUS_KEYS[doc.status] ? t(DOC_STATUS_KEYS[doc.status]) : doc.status}
                        </Badge>
                        {doc.status !== "verified" && (
                          <button onClick={() => setDocStatus(doc, "verified")} className="text-xs text-emerald-700 dark:text-emerald-400 hover:underline">
                            {t("merchants.verify")}
                          </button>
                        )}
                        {doc.status !== "rejected" && (
                          <button onClick={() => setDocStatus(doc, "rejected")} className="text-xs text-red-600 dark:text-red-400 hover:underline">
                            {t("merchants.reject")}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ),
      filterValue: (m) => `${m.business_name} ${privOf(m).owner_full_name ?? ""}`,
      sortValue: (m) => m.business_name,
      csvValue: (m) => m.business_name,
    },
    {
      key: "status",
      header: t("common.status"),
      render: (m) => (
        <Badge variant={statusVariant[m.status] ?? "default"} className="capitalize">
          {MERCHANT_STATUS_KEYS[m.status] ? t(MERCHANT_STATUS_KEYS[m.status]) : m.status}
        </Badge>
      ),
      csvValue: (m) => m.status,
    },
    {
      key: "actions",
      header: "",
      render: (m) => (
        <div className="flex items-center gap-2 justify-end flex-wrap">
          <Button size="sm" variant="outline" onClick={() => setDetailId(m.id)}>
            {t("customerDetail.details")}
          </Button>
          {isAdmin && (m.status === "registered" || m.status === "pending_verification" || m.status === "under_review") && (
            <>
              <Button size="sm" onClick={() => updateStatus(m, "active")}>
                {t("merchants.approve")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setReasonPromptId(reasonPromptId === m.id ? null : m.id);
                  setReasonPromptKind("rejected");
                }}
              >
                {t("merchants.reject")}
              </Button>
            </>
          )}
          {m.status === "active" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setReasonPromptId(reasonPromptId === m.id ? null : m.id);
                setReasonPromptKind("suspended");
              }}
            >
              {t("customers.suspend")}
            </Button>
          )}
          {m.status === "suspended" && (
            <Button size="sm" onClick={() => updateStatus(m, "active")}>
              {t("customers.reactivate")}
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-end mb-4">
        <ExportCsvButton onExport={handleExport} disabled={merchants.length === 0} />
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => setSearchParams(s === "all" ? {} : { status: s })}
            className={`px-3 py-1.5 rounded-full text-xs border capitalize ${
              statusFilter === s ? "bg-navy text-white border-navy dark:bg-navy-light dark:border-navy-light" : "bg-white dark:bg-navy-dark dark:border-white/20 dark:text-gray-300"
            }`}
          >
            {t(MERCHANT_STATUS_KEYS[s] ?? "merchantStatus.all")}
          </button>
        ))}
      </div>

      {loading ? (
        <SkeletonRows />
      ) : merchants.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400">{t("merchants.noMerchantsInView")}</p>
      ) : (
        <>
          <DataTable storageKey="admin.merchants" columns={columns} rows={merchants} getRowId={(m) => m.id} />
          <div className="mt-4">
            <Pagination page={page} totalPages={totalPagesFor(totalCount, ADMIN_PAGE_SIZE)} onPageChange={setPage} />
          </div>
        </>
      )}

      <Sheet open={detailId !== null} onClose={() => setDetailId(null)} title={t("merchantDetail.title")} width="wide">
        {detailId && (
          <MerchantDetail
            merchantId={detailId}
            onChanged={load}
            onDeleted={() => {
              setDetailId(null);
              load();
            }}
          />
        )}
      </Sheet>
    </div>
  );
}
