import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Package } from "lucide-react";
import {
  ADMIN_PAGE_SIZE,
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  LazyImage,
  Pagination,
  SkeletonRows,
  exportToCsv,
  formatCurrency,
  formatDate,
  toast,
  totalPagesFor,
  translateServerError,
  useCategoryName,
  usePagination,
  useTranslation,
  type DataTableColumn,
} from "@tolo/ui";
import { supabase } from "../lib/supabase";
import { merchantProducts, type ShopRef } from "../data/merchantProducts";
import { useMerchant } from "../lib/MerchantContext";
import type { Product } from "../types";

const statusVariant: Record<string, "default" | "warning" | "info" | "success" | "danger"> = {
  draft: "default",
  submitted: "warning",
  approved: "info",
  published: "success",
  paused: "warning",
  archived: "danger",
};

// What the merchant sees for each status: "paused" is the hide/show toggle, so it reads "Hidden".
const STATUS_KEYS: Record<string, string> = {
  draft: "merchantProducts.status.draft",
  submitted: "merchantProducts.status.submitted",
  approved: "merchantProducts.status.approved",
  published: "merchantProducts.status.published",
  paused: "merchantProducts.status.paused",
  archived: "merchantProducts.status.archived",
};

type Tab = "active" | "archived";

type Dialog =
  | { kind: "archive"; products: Product[] }
  | { kind: "delete"; product: Product }
  | { kind: "deleteBlocked"; product: Product };

function totalStockOf(p: Product): number {
  return p.product_variants.reduce((sum, v) => sum + (v.inventory?.stock_quantity ?? 0), 0);
}

export function Products() {
  const { t } = useTranslation();
  const categoryName = useCategoryName();
  const { merchant, store } = useMerchant();
  const [tab, setTab] = useState<Tab>("active");
  const [products, setProducts] = useState<Product[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [bulkUploadEnabled, setBulkUploadEnabled] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [working, setWorking] = useState(false);
  const { page, setPage } = usePagination({ pageSize: ADMIN_PAGE_SIZE, resetKey: tab });

  useEffect(() => {
    // Platform-wide toggle (admin-dashboard Settings.tsx, merchant_features
    // .bulk_upload_enabled) — there's no per-merchant override for any
    // merchant_features flag in this schema, so this is the same value for
    // every merchant.
    supabase
      .from("system_settings")
      .select("value")
      .eq("key", "merchant_features")
      .maybeSingle()
      .then(({ data }) => {
        const features = data?.value as { bulk_upload_enabled?: boolean } | null;
        setBulkUploadEnabled(features?.bulk_upload_enabled ?? false);
      });
  }, []);

  // The shop the Supabase backend works for; the API backend finds the signed-in account's own shop.
  const shopRef: ShopRef | null = merchant && store ? { merchantId: merchant.id, storeId: store.id } : null;

  async function load() {
    if (!shopRef) return;
    setLoading(true);
    // The active tab hides archived products; the archived tab shows only those.
    const { items, total } = await merchantProducts.list(shopRef, tab, page, ADMIN_PAGE_SIZE);
    setProducts(items);
    setTotalCount(total);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchant, store, page, tab]);

  /** Drops rows from the list without a full reload (a reload would blank the table). */
  function removeFromView(ids: string[]) {
    setProducts((prev) => prev.filter((p) => !ids.includes(p.id)));
    setTotalCount((prev) => Math.max(0, prev - ids.length));
  }

  async function toggleVisibility(p: Product) {
    const next = p.status === "published" ? "paused" : "published";
    const result = await merchantProducts.setVisible([p.id], next === "published");
    if (!result.ok) {
      toast.error(translateServerError(result.error, t));
      return;
    }
    setProducts((prev) => prev.map((prod) => (prod.id === p.id ? { ...prod, status: next } : prod)));
    toast.success(next === "published" ? t("merchantProducts.nowVisible") : t("merchantProducts.nowHidden"));
  }

  // Hides every selected live product in one go instead of one click per row.
  async function bulkHide(selected: Product[]) {
    const live = selected.filter((p) => p.status === "published");
    if (live.length === 0) return;
    await merchantProducts.setVisible(live.map((p) => p.id), false);
    setProducts((prev) => prev.map((p) => (live.some((sel) => sel.id === p.id) ? { ...p, status: "paused" } : p)));
  }

  async function confirmArchive() {
    if (dialog?.kind !== "archive") return;
    setWorking(true);
    const ids = dialog.products.map((p) => p.id);
    const result = await merchantProducts.archive(ids);
    setWorking(false);
    setDialog(null);
    if (!result.ok) {
      toast.error(translateServerError(result.error, t));
      return;
    }
    removeFromView(ids);
    toast.success(t("merchantProducts.archivedToast", { count: result.count }));
  }

  async function restore(selected: Product[]) {
    const ids = selected.map((p) => p.id);
    const result = await merchantProducts.restore(ids);
    if (!result.ok) {
      toast.error(translateServerError(result.error, t));
      return;
    }
    if (result.restored > 0) {
      removeFromView(ids);
      toast.success(t("merchantProducts.restoredToast", { count: result.restored }));
    }
    if (result.blocked > 0) toast.error(t("merchantProducts.restoreBlocked", { count: result.blocked }));
  }

  // Delete asks the database first: a product any order has referenced has to stay in the records,
  // so the merchant is offered "Archive instead" rather than a delete that would fail.
  async function startDelete(p: Product) {
    const result = await merchantProducts.hasOrders(p.id);
    if (!result.ok) {
      toast.error(translateServerError(result.error, t));
      return;
    }
    setDialog(result.hasOrders ? { kind: "deleteBlocked", product: p } : { kind: "delete", product: p });
  }

  async function confirmDelete() {
    if (dialog?.kind !== "delete") return;
    setWorking(true);
    const deleted = dialog.product;
    const result = await merchantProducts.remove(deleted.id);
    setWorking(false);
    setDialog(null);
    if (!result.ok) {
      // Some backends can only find out that an order refers to the product when the delete is refused.
      if (result.hasOrders) setDialog({ kind: "deleteBlocked", product: deleted });
      else toast.error(translateServerError(result.error, t));
      return;
    }
    removeFromView([deleted.id]);
    toast.success(t("merchantProducts.deletedToast", { name: deleted.name }));
  }

  async function handleExportAll() {
    if (!shopRef) return;
    const rows = await merchantProducts.listAll(shopRef, tab);
    exportToCsv(
      `products-${tab}-${new Date().toISOString().slice(0, 10)}.csv`,
      rows.map((p) => ({
        id: p.id,
        name: p.name,
        category: p.categories?.name ?? "",
        status: p.status,
        price: p.base_price,
        stock: totalStockOf(p),
      })),
    );
  }

  const columns: DataTableColumn<Product>[] = [
    {
      key: "name",
      header: t("common.product"),
      render: (p) => (
        <div className="flex items-center gap-3 min-w-0">
          <LazyImage src={p.product_images[0]?.url} alt={p.name} className="w-10 h-10 flex-shrink-0 rounded" />
          <div className="min-w-0">
            <Link to={`/products/${p.id}`} className="font-medium hover:text-navy dark:hover:text-navy-light truncate block">
              {p.name}
            </Link>
            {p.status === "archived" && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {p.archived_by_role === "staff" ? t("merchantProducts.archivedByAdmin") : t("merchantProducts.archivedByYou")}
                {p.archived_at && ` · ${formatDate(p.archived_at)}`}
              </p>
            )}
          </div>
        </div>
      ),
      filterValue: (p) => p.name,
      sortValue: (p) => p.name,
      csvValue: (p) => p.name,
    },
    {
      key: "category",
      header: t("common.category"),
      render: (p) => (p.categories ? categoryName(p.categories) : t("common.uncategorized")),
      filterValue: (p) => p.categories?.name ?? "",
      csvValue: (p) => p.categories?.name ?? "",
    },
    { key: "stock", header: t("common.stock"), render: (p) => totalStockOf(p), sortValue: totalStockOf, csvValue: totalStockOf, align: "right" },
    {
      key: "status",
      header: t("common.status"),
      render: (p) => <Badge variant={statusVariant[p.status] ?? "default"}>{t(STATUS_KEYS[p.status] ?? "merchantProducts.status.draft")}</Badge>,
      csvValue: (p) => p.status,
    },
    {
      key: "price",
      header: t("common.price"),
      render: (p) => formatCurrency(p.base_price),
      sortValue: (p) => p.base_price,
      csvValue: (p) => p.base_price,
      align: "right",
    },
    {
      key: "actions",
      header: "",
      render: (p) => (
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {p.status === "archived" ? (
            // A product Tolo archived stays archived until Tolo restores it: no restore (or delete) here.
            p.archived_by_role === "staff" ? (
              <span className="text-xs text-gray-500 dark:text-gray-400">{t("merchantProducts.archivedByAdmin")}</span>
            ) : (
              <>
                <Button size="sm" variant="outline" onClick={() => restore([p])}>
                  {t("merchantProducts.restore")}
                </Button>
                <Button size="sm" variant="destructive" onClick={() => startDelete(p)}>
                  {t("merchantProducts.delete")}
                </Button>
              </>
            )
          ) : (
            <>
              <Link
                to={`/products/${p.id}`}
                className="inline-flex items-center h-8 px-3 text-xs font-medium rounded-md border-2 border-navy text-navy hover:bg-navy-50 dark:border-navy-light dark:text-navy-light dark:hover:bg-navy-dark/40"
              >
                {t("merchantProducts.edit")}
              </Link>
              {(p.status === "published" || p.status === "paused") && (
                <Button size="sm" variant="outline" onClick={() => toggleVisibility(p)}>
                  {p.status === "published" ? t("merchantProducts.hide") : t("merchantProducts.show")}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "archive", products: [p] })}>
                {t("merchantProducts.archive")}
              </Button>
              <Button size="sm" variant="destructive" onClick={() => startDelete(p)}>
                {t("merchantProducts.delete")}
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  if (!store) {
    return <p className="text-gray-600 dark:text-gray-400">{t("merchantProducts.setUpStorePrompt")}</p>;
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-xl font-bold dark:text-gray-100">{t("merchantDashboard.products")}</h1>
        <div className="flex items-center gap-2">
          {bulkUploadEnabled && (
            <Link to="/products-bulk-upload" className="text-sm border dark:border-white/20 dark:text-gray-200 px-4 py-2 rounded-md hover:bg-gray-50 dark:hover:bg-white/5">
              {t("merchantProducts.bulkUpload")}
            </Link>
          )}
          <Link to="/products/new" className="bg-navy dark:bg-navy-light text-white text-sm px-4 py-2 rounded-md hover:bg-navy-dark dark:hover:bg-navy">
            {t("merchantProducts.newProduct")}
          </Link>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b dark:border-white/10 mb-4">
        {(["active", "archived"] as const).map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === key
                ? "border-navy dark:border-navy-light text-navy dark:text-navy-light"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            }`}
          >
            {key === "active" ? t("merchantProducts.tabActive") : t("merchantProducts.tabArchived")}
          </button>
        ))}
      </div>

      {loading ? (
        <SkeletonRows />
      ) : products.length === 0 && tab === "active" ? (
        <EmptyState
          icon={Package}
          title={t("merchantProducts.noProductsTitle")}
          description={t("merchantProducts.noProductsDescription")}
          action={
            <Link to="/products/new">
              <Button>{t("merchantProducts.addFirstProduct")}</Button>
            </Link>
          }
        />
      ) : (
        <>
          <DataTable
            storageKey={`merchant.products.${tab}`}
            columns={columns}
            rows={products}
            getRowId={(p) => p.id}
            emptyMessage={tab === "archived" ? t("merchantProducts.noArchived") : undefined}
            bulkActions={
              tab === "archived"
                ? [{ label: t("merchantProducts.restore"), onAction: (rows) => restore(rows.filter((p) => p.archived_by_role !== "staff")) }]
                : [
                    { label: t("merchantProducts.hide"), onAction: bulkHide },
                    { label: t("merchantProducts.archive"), onAction: (rows) => setDialog({ kind: "archive", products: rows }), variant: "destructive" },
                  ]
            }
            onExportAll={handleExportAll}
          />
          <div className="mt-4">
            <Pagination page={page} totalPages={totalPagesFor(totalCount, ADMIN_PAGE_SIZE)} onPageChange={setPage} />
          </div>
        </>
      )}

      <ConfirmDialog
        open={dialog?.kind === "archive"}
        title={
          dialog?.kind === "archive"
            ? dialog.products.length === 1
              ? t("merchantProducts.archiveTitle", { name: dialog.products[0].name })
              : t("merchantProducts.archiveManyTitle", { count: dialog.products.length })
            : ""
        }
        message={t("merchantProducts.archiveMessage")}
        confirmLabel={t("merchantProducts.archive")}
        busyLabel={t("merchantProducts.archiving")}
        busy={working}
        tone="primary"
        onConfirm={confirmArchive}
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog?.kind === "delete"}
        title={dialog?.kind === "delete" ? t("merchantProducts.deleteTitle", { name: dialog.product.name }) : ""}
        message={t("merchantProducts.deleteMessage")}
        confirmLabel={t("merchantProducts.deleteForever")}
        busyLabel={t("merchantProducts.deleting")}
        busy={working}
        onConfirm={confirmDelete}
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog?.kind === "deleteBlocked"}
        title={t("merchantProducts.deleteBlockedTitle")}
        message={t("merchantProducts.deleteBlockedMessage")}
        confirmLabel={t("merchantProducts.archiveInstead")}
        busyLabel={t("merchantProducts.archiving")}
        busy={working}
        tone="primary"
        onConfirm={() => dialog?.kind === "deleteBlocked" && setDialog({ kind: "archive", products: [dialog.product] })}
        onCancel={() => setDialog(null)}
      />
    </div>
  );
}
