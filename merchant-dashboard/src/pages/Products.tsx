import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Package } from "lucide-react";
import {
  ADMIN_PAGE_SIZE,
  Badge,
  Button,
  DataTable,
  EmptyState,
  LazyImage,
  Pagination,
  SkeletonRows,
  exportToCsv,
  fetchAllRows,
  formatCurrency,
  totalPagesFor,
  usePagination,
  useTranslation,
  type DataTableColumn,
} from "@tolo/ui";
import { supabase } from "../lib/supabase";
import { useMerchant } from "../lib/MerchantContext";
import type { Product } from "../types";
import type { FetchPageResult } from "@tolo/ui";

const PRODUCT_SELECT = `
  id, merchant_id, store_id, category_id, name, slug, description, base_price, discount_price, status,
  product_variants ( id, product_id, sku, attributes, price, discount_price, is_default, inventory ( stock_quantity, reserved_quantity, available_quantity ) ),
  product_images ( id, url, is_primary ),
  categories ( name )
`;

const statusVariant: Record<string, "default" | "warning" | "info" | "success" | "danger"> = {
  draft: "default",
  submitted: "warning",
  approved: "info",
  published: "success",
  paused: "warning",
  archived: "danger",
};

function totalStockOf(p: Product): number {
  return p.product_variants.reduce((sum, v) => sum + (v.inventory?.stock_quantity ?? 0), 0);
}

export function Products() {
  const { t } = useTranslation();
  const { merchant, store } = useMerchant();
  const [products, setProducts] = useState<Product[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [bulkUploadEnabled, setBulkUploadEnabled] = useState(false);
  const { page, from, to, setPage } = usePagination({ pageSize: ADMIN_PAGE_SIZE });

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

  async function load() {
    if (!merchant) return;
    setLoading(true);
    const { data, count } = await supabase
      .from("products")
      .select(PRODUCT_SELECT, { count: "exact" })
      .eq("merchant_id", merchant.id)
      .order("created_at", { ascending: false })
      .range(from, to);
    setProducts((data as unknown as Product[]) ?? []);
    setTotalCount(count ?? 0);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchant, from, to]);

  async function togglePause(p: Product) {
    const next = p.status === "published" ? "paused" : "published";
    const { error } = await supabase.from("products").update({ status: next }).eq("id", p.id);
    if (error) return;
    setProducts((prev) => prev.map((prod) => (prod.id === p.id ? { ...prod, status: next } : prod)));
  }

  // Item 4 bulk action: pause every selected published product in one go
  // instead of one Pause click per row.
  async function bulkPause(selected: Product[]) {
    const published = selected.filter((p) => p.status === "published");
    if (published.length === 0) return;
    await supabase.from("products").update({ status: "paused" }).in("id", published.map((p) => p.id));
    setProducts((prev) => prev.map((p) => (published.some((sel) => sel.id === p.id) ? { ...p, status: "paused" } : p)));
  }

  async function handleExportAll() {
    if (!merchant) return;
    const rows = await fetchAllRows<Product>(
      (rangeFrom, rangeTo) =>
        supabase.from("products").select(PRODUCT_SELECT).eq("merchant_id", merchant.id).order("created_at", { ascending: false }).range(rangeFrom, rangeTo) as unknown as PromiseLike<
          FetchPageResult<Product>
        >,
    );
    exportToCsv(
      `products-${new Date().toISOString().slice(0, 10)}.csv`,
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
          <Link to={`/products/${p.id}`} className="font-medium hover:text-navy dark:hover:text-navy-light truncate">
            {p.name}
          </Link>
        </div>
      ),
      filterValue: (p) => p.name,
      sortValue: (p) => p.name,
      csvValue: (p) => p.name,
    },
    {
      key: "category",
      header: t("common.category"),
      render: (p) => p.categories?.name ?? t("common.uncategorized"),
      filterValue: (p) => p.categories?.name ?? "",
      csvValue: (p) => p.categories?.name ?? "",
    },
    { key: "stock", header: t("common.stock"), render: (p) => totalStockOf(p), sortValue: totalStockOf, csvValue: totalStockOf, align: "right" },
    {
      key: "status",
      header: t("common.status"),
      render: (p) => (
        <Badge variant={statusVariant[p.status] ?? "default"} className="capitalize">
          {p.status}
        </Badge>
      ),
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
      render: (p) =>
        p.status === "published" || p.status === "paused" ? (
          <Button size="sm" variant="outline" onClick={() => togglePause(p)}>
            {p.status === "published" ? t("merchantProducts.pause") : t("merchantProducts.publish")}
          </Button>
        ) : null,
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

      {loading ? (
        <SkeletonRows />
      ) : products.length === 0 ? (
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
            storageKey="merchant.products"
            columns={columns}
            rows={products}
            getRowId={(p) => p.id}
            bulkActions={[{ label: t("merchantProducts.pause"), onAction: bulkPause }]}
            onExportAll={handleExportAll}
          />
          <div className="mt-4">
            <Pagination page={page} totalPages={totalPagesFor(totalCount, ADMIN_PAGE_SIZE)} onPageChange={setPage} />
          </div>
        </>
      )}
    </div>
  );
}
