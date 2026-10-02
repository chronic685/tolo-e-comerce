import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { edgeFunctionError } from "../lib/edgeFunctionError";
import {
  ADMIN_PAGE_SIZE,
  Badge,
  Button,
  DataTable,
  Pagination,
  SkeletonRows,
  exportToCsv,
  fetchAllRows,
  toast,
  totalPagesFor,
  usePagination,
  useTranslation,
  type DataTableColumn,
  type FetchPageResult,
} from "@tolo/ui";

// Applications submitted from the Tolo app (migration 0073). Reviewed by
// admin/super_admin only -- the route is adminTierOnly in adminPages.ts and
// RLS returns nothing to anyone else.
interface MerchantApplication {
  id: string;
  applicant_phone: string;
  business_name: string;
  address: string;
  license_photo_url: string;
  status: "pending" | "approved" | "rejected";
  admin_note: string | null;
  reviewed_at: string | null;
  merchant_id: string | null;
  created_at: string;
  categories: { name: string } | null;
  reviewer: { full_name: string | null } | null;
}

const STATUS_FILTERS = ["pending", "approved", "rejected", "all"] as const;
const LICENSE_BUCKET = "merchant-application-licenses";
const SELECT =
  "id, applicant_phone, business_name, address, license_photo_url, status, admin_note, reviewed_at, merchant_id, created_at, categories ( name ), reviewer:profiles!merchant_applications_reviewed_by_fkey ( full_name )";

const statusVariant = { pending: "warning", approved: "success", rejected: "danger" } as const;

const APPLICATION_STATUS_KEYS: Record<string, string> = {
  pending: "applicationStatus.pending",
  approved: "applicationStatus.approved",
  rejected: "applicationStatus.rejected",
  all: "applicationStatus.all",
};

export function MerchantApplications() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const statusFilter = searchParams.get("status") ?? "pending";
  const [applications, setApplications] = useState<MerchantApplication[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const { page, from, to, setPage } = usePagination({ pageSize: ADMIN_PAGE_SIZE, resetKey: statusFilter });
  const [review, setReview] = useState<{ id: string; action: "approve" | "reject" } | null>(null);
  const [note, setNote] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  function query() {
    let q = supabase.from("merchant_applications").select(SELECT, { count: "exact" }).order("created_at", { ascending: statusFilter === "pending" });
    if (statusFilter !== "all") q = q.eq("status", statusFilter);
    return q;
  }

  async function load() {
    setLoading(true);
    const { data, count } = await query().range(from, to);
    setApplications((data as unknown as MerchantApplication[]) ?? []);
    setTotalCount(count ?? 0);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, from, to]);

  // The bucket is private (migration 0074): a short-lived signed URL,
  // created only when an admin actually opens the photo.
  async function viewLicense(a: MerchantApplication) {
    const { data, error } = await supabase.storage.from(LICENSE_BUCKET).createSignedUrl(a.license_photo_url, 300);
    if (error || !data) {
      toast.error(t("merchantApplications.licenseOpenError"));
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  }

  function startReview(a: MerchantApplication, action: "approve" | "reject") {
    setReview(review?.id === a.id && review.action === action ? null : { id: a.id, action });
    setNote("");
  }

  async function confirmReview(a: MerchantApplication) {
    if (!review) return;
    const trimmedNote = note.trim() || null;
    setBusyId(a.id);
    const { data, error } = await supabase.functions.invoke("review-merchant-application", {
      body: { application_id: a.id, action: review.action, note: trimmedNote ?? undefined },
    });
    setBusyId(null);
    if (error) {
      toast.error(await edgeFunctionError(error));
      return;
    }
    toast.success(
      review.action === "approve"
        ? t("merchantApplications.approvedToast", { name: a.business_name })
        : t("merchantApplications.rejectedToast", { name: a.business_name }),
    );
    setReview(null);
    setNote("");
    const status = data?.status as MerchantApplication["status"];
    // Same in-place update as Merchants.tsx: drop the row if it no longer
    // matches the active status tab, otherwise update it where it is.
    if (statusFilter !== "all" && status !== statusFilter) {
      setApplications((prev) => prev.filter((x) => x.id !== a.id));
      setTotalCount((prev) => Math.max(0, prev - 1));
    } else {
      setApplications((prev) =>
        prev.map((x) =>
          x.id === a.id ? { ...x, status, admin_note: trimmedNote, merchant_id: data?.merchant_id ?? null, reviewed_at: new Date().toISOString() } : x,
        ),
      );
    }
  }

  async function handleExportAll() {
    const rows = await fetchAllRows<MerchantApplication>((rangeFrom, rangeTo) =>
      query().range(rangeFrom, rangeTo) as unknown as PromiseLike<FetchPageResult<MerchantApplication>>,
    );
    exportToCsv(
      `merchant-applications-${statusFilter}-${new Date().toISOString().slice(0, 10)}.csv`,
      rows.map((a) => ({
        id: a.id,
        business_name: a.business_name,
        category: a.categories?.name ?? "",
        phone: a.applicant_phone,
        address: a.address,
        status: a.status,
        admin_note: a.admin_note ?? "",
        submitted_at: a.created_at,
        reviewed_at: a.reviewed_at ?? "",
        merchant_id: a.merchant_id ?? "",
      })),
    );
  }

  const columns: DataTableColumn<MerchantApplication>[] = [
    {
      key: "business",
      header: t("merchantApplications.businessColumn"),
      render: (a) => (
        <div>
          <p className="font-medium dark:text-gray-100">{a.business_name}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">{a.categories?.name ?? "—"}</p>
        </div>
      ),
      filterValue: (a) => `${a.business_name} ${a.categories?.name ?? ""}`,
      sortValue: (a) => a.business_name,
      csvValue: (a) => a.business_name,
    },
    { key: "phone", header: t("common.phone"), render: (a) => a.applicant_phone, filterValue: (a) => a.applicant_phone, csvValue: (a) => a.applicant_phone },
    {
      key: "address",
      header: t("merchantApplications.addressColumn"),
      render: (a) => <span className="text-sm">{a.address}</span>,
      filterValue: (a) => a.address,
      csvValue: (a) => a.address,
      hideByDefault: true,
    },
    {
      key: "submitted",
      header: t("merchantApplications.submittedColumn"),
      render: (a) => new Date(a.created_at).toLocaleString(),
      sortValue: (a) => a.created_at,
      csvValue: (a) => a.created_at,
    },
    {
      key: "license",
      header: t("merchantApplications.licenseColumn"),
      render: (a) => (
        <Button size="sm" variant="outline" onClick={() => viewLicense(a)}>
          {t("merchantApplications.viewPhoto")}
        </Button>
      ),
    },
    {
      key: "status",
      header: t("common.status"),
      render: (a) => (
        <div>
          <Badge variant={statusVariant[a.status]} className="capitalize">
            {t(APPLICATION_STATUS_KEYS[a.status] ?? "applicationStatus.pending")}
          </Badge>
          {a.reviewed_at && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {a.reviewer?.full_name ? `${a.reviewer.full_name}, ` : ""}
              {new Date(a.reviewed_at).toLocaleDateString()}
            </p>
          )}
          {a.admin_note && <p className="text-xs text-gray-600 dark:text-gray-300 mt-0.5">{a.admin_note}</p>}
        </div>
      ),
      filterValue: (a) => `${a.status} ${a.admin_note ?? ""}`,
      sortValue: (a) => a.status,
      csvValue: (a) => a.status,
    },
    {
      key: "actions",
      header: "",
      render: (a) =>
        a.status !== "pending" ? null : (
          <div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => startReview(a, "approve")} disabled={busyId === a.id}>
                {t("merchants.approve")}
              </Button>
              <Button size="sm" variant="destructive" onClick={() => startReview(a, "reject")} disabled={busyId === a.id}>
                {t("merchants.reject")}
              </Button>
            </div>
            {review?.id === a.id && (
              <div className="flex gap-2 mt-2">
                <input
                  placeholder={review.action === "approve" ? t("merchantApplications.notePlaceholder") : t("merchantApplications.rejectReasonPlaceholder")}
                  value={note}
                  maxLength={1000}
                  onChange={(e) => setNote(e.target.value)}
                  className="flex-1 border rounded-md px-3 py-1.5 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
                />
                <Button
                  size="sm"
                  variant={review.action === "approve" ? "default" : "destructive"}
                  onClick={() => confirmReview(a)}
                  disabled={busyId === a.id}
                >
                  {review.action === "approve" ? t("merchantApplications.confirmApprove") : t("merchants.confirmReject")}
                </Button>
              </div>
            )}
          </div>
        ),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold dark:text-gray-100">{t("merchantApplications.title")}</h1>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{t("merchantApplications.description")}</p>

      <div className="flex gap-2 mb-4">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => setSearchParams(s === "pending" ? {} : { status: s })}
            className={`px-3 py-1.5 rounded-md text-sm font-medium capitalize ${
              statusFilter === s
                ? "bg-navy text-white dark:bg-navy-light"
                : "bg-white border text-gray-700 dark:bg-navy-dark dark:border-white/20 dark:text-gray-300"
            }`}
          >
            {t(APPLICATION_STATUS_KEYS[s])}
          </button>
        ))}
      </div>

      {loading ? (
        <SkeletonRows />
      ) : (
        <>
          <DataTable
            storageKey="admin.merchantApplications"
            columns={columns}
            rows={applications}
            getRowId={(a) => a.id}
            onExportAll={handleExportAll}
            emptyMessage={statusFilter === "pending" ? t("merchantApplications.noneWaiting") : t("merchantApplications.noneFound")}
          />
          <div className="mt-4">
            <Pagination page={page} totalPages={totalPagesFor(totalCount, ADMIN_PAGE_SIZE)} onPageChange={setPage} />
          </div>
        </>
      )}
    </div>
  );
}
