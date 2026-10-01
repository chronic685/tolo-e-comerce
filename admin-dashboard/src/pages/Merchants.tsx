import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { exportToCsv } from "../lib/csvExport";
import { ADMIN_PAGE_SIZE, Badge, Button, DataTable, ExportCsvButton, fetchAllRows, Pagination, SkeletonRows, totalPagesFor, usePagination, type DataTableColumn } from "@tolo/ui";
import { useAuth } from "../lib/AuthContext";
import type { Merchant, MerchantDocument } from "../types";

const STATUS_FILTERS = ["all", "registered", "under_review", "active", "suspended", "rejected", "closed"];

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

export function Merchants() {
  const { user } = useAuth();
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

  async function load() {
    setLoading(true);
    let query = supabase.from("merchants").select("*", { count: "exact" }).order("created_at", { ascending: false });
    if (statusFilter !== "all") query = query.eq("status", statusFilter);
    const { data, count } = await query.range(from, to);
    setMerchants(data ?? []);
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
    const rows = await fetchAllRows<Merchant>((from, to) => {
      let query = supabase.from("merchants").select("*").order("created_at", { ascending: false });
      if (statusFilter !== "all") query = query.eq("status", statusFilter);
      return query.range(from, to);
    });
    exportToCsv(
      `merchants-${statusFilter}-${new Date().toISOString().slice(0, 10)}.csv`,
      rows.map((m) => ({
        id: m.id,
        business_name: m.business_name,
        category: m.business_category ?? "",
        subcategory: m.business_subcategory ?? "",
        phone: m.phone ?? "",
        email: m.email ?? "",
        city: m.city ?? "",
        sub_city: m.sub_city ?? "",
        status: m.status,
        owner_full_name: m.owner_full_name ?? "",
        owner_phone: m.owner_phone ?? "",
        created_at: m.created_at,
      })),
    );
  }

  const columns: DataTableColumn<Merchant>[] = [
    {
      key: "business",
      header: "Merchant",
      render: (m) => (
        <div>
          <button className="text-left" onClick={() => toggleExpand(m)}>
            <p className="font-medium text-sm hover:text-navy dark:hover:text-navy-light">{m.business_name}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {[m.business_category, m.business_subcategory].filter(Boolean).join(" · ") || "—"} ·{" "}
              {[m.city, m.sub_city].filter(Boolean).join(", ") || m.location || "—"}
            </p>
            {m.status === "rejected" && m.rejection_reason && <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">Rejected: {m.rejection_reason}</p>}
            {m.status === "suspended" && m.suspension_reason && <p className="text-xs text-orange-600 dark:text-orange-400 mt-0.5">Suspended: {m.suspension_reason}</p>}
          </button>

          {reasonPromptId === m.id && reasonPromptKind && (
            <div className="pt-2 flex gap-2">
              <input
                placeholder={`Reason for ${reasonPromptKind === "rejected" ? "rejection" : "suspension"}`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="flex-1 border rounded-md px-3 py-1.5 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
              />
              <Button size="sm" variant="destructive" onClick={() => updateStatus(m, reasonPromptKind, reason || undefined)}>
                Confirm {reasonPromptKind === "rejected" ? "reject" : "suspend"}
              </Button>
            </div>
          )}

          {expandedId === m.id && (
            <div className="bg-gray-50 dark:bg-white/5 -mx-3 px-3 mt-3 py-3 text-sm border-t dark:border-white/10">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Owner</p>
              <p className="mb-3">
                {m.owner_full_name ?? "—"} · {m.owner_phone ?? "—"} · {m.owner_email ?? m.email ?? "—"}
              </p>

              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Performance</p>
              {performance ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                  <div className="bg-white dark:bg-navy-dark border dark:border-white/10 rounded-md px-3 py-2">
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">Acceptance Rate</p>
                    <p className="text-sm font-semibold">{performance.acceptance_rate != null ? `${performance.acceptance_rate}%` : "—"}</p>
                  </div>
                  <div className="bg-white dark:bg-navy-dark border dark:border-white/10 rounded-md px-3 py-2">
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">Cancellation Rate</p>
                    <p className="text-sm font-semibold">{performance.cancellation_rate != null ? `${performance.cancellation_rate}%` : "—"}</p>
                  </div>
                  <div className="bg-white dark:bg-navy-dark border dark:border-white/10 rounded-md px-3 py-2">
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">Avg. Prep Time</p>
                    <p className="text-sm font-semibold">{performance.avg_prep_minutes != null ? `${performance.avg_prep_minutes} min` : "—"}</p>
                  </div>
                  <div className="bg-white dark:bg-navy-dark border dark:border-white/10 rounded-md px-3 py-2">
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">Rating</p>
                    <p className="text-sm font-semibold">
                      {performance.avg_rating != null ? `${performance.avg_rating} ★ (${performance.review_count})` : "No reviews"}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-gray-500 dark:text-gray-400 text-xs mb-3">Loading...</p>
              )}

              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Documents</p>
              {documents.length === 0 ? (
                <p className="text-gray-500 dark:text-gray-400 text-xs">No documents uploaded yet.</p>
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
                          {doc.status.replace(/_/g, " ")}
                        </Badge>
                        {doc.status !== "verified" && (
                          <button onClick={() => setDocStatus(doc, "verified")} className="text-xs text-emerald-700 dark:text-emerald-400 hover:underline">
                            Verify
                          </button>
                        )}
                        {doc.status !== "rejected" && (
                          <button onClick={() => setDocStatus(doc, "rejected")} className="text-xs text-red-600 dark:text-red-400 hover:underline">
                            Reject
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
      filterValue: (m) => `${m.business_name} ${m.owner_full_name ?? ""}`,
      sortValue: (m) => m.business_name,
      csvValue: (m) => m.business_name,
    },
    {
      key: "status",
      header: "Status",
      render: (m) => <Badge variant={statusVariant[m.status] ?? "default"} className="capitalize">{m.status.replace(/_/g, " ")}</Badge>,
      csvValue: (m) => m.status,
    },
    {
      key: "actions",
      header: "",
      render: (m) => (
        <div className="flex items-center gap-2 justify-end flex-wrap">
          {(m.status === "registered" || m.status === "pending_verification" || m.status === "under_review") && (
            <>
              <Button size="sm" onClick={() => updateStatus(m, "active")}>
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setReasonPromptId(reasonPromptId === m.id ? null : m.id);
                  setReasonPromptKind("rejected");
                }}
              >
                Reject
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
              Suspend
            </Button>
          )}
          {m.status === "suspended" && (
            <Button size="sm" onClick={() => updateStatus(m, "active")}>
              Reactivate
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold dark:text-gray-100">Merchants</h1>
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
            {s.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      {loading ? (
        <SkeletonRows />
      ) : merchants.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400">No merchants in this view.</p>
      ) : (
        <>
          <DataTable storageKey="admin.merchants" columns={columns} rows={merchants} getRowId={(m) => m.id} />
          <div className="mt-4">
            <Pagination page={page} totalPages={totalPagesFor(totalCount, ADMIN_PAGE_SIZE)} onPageChange={setPage} />
          </div>
        </>
      )}
    </div>
  );
}
