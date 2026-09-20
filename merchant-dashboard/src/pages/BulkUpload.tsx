import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useMerchant } from "../lib/MerchantContext";
import { buildCsv, downloadCsv, parseCsvToObjects } from "../lib/csv";
import { isEligibleForListing, LISTING_ELIGIBILITY_ERROR, parseAttributes, slugify } from "../lib/productRules";
import { saveProduct } from "../lib/productWrites";
import type { Category } from "../types";

// CSV columns, in the order the template uses them. One row == one product
// with a single default variant — multi-variant products (e.g. several
// sizes of the same item) still need the normal product editor for the
// additional variants, since encoding "N variants per product" cleanly in
// one flat CSV row gets complicated fast for a first version of this.
const TEMPLATE_HEADERS = ["name", "description", "category", "price", "stock", "sku", "attributes", "image_url"];
const TEMPLATE_EXAMPLE_ROWS = [
  ["Wireless Mouse", "Ergonomic wireless mouse with USB receiver", "Electronics", "450", "10", "WM-001", "color:Black", ""],
  ["Leather Wallet", "Genuine leather bifold wallet", "Fashion", "1200", "1", "LW-002", "color:Brown", "https://example.com/wallet.jpg"],
];

type PlannedStatus = "published" | "submitted" | "draft";

interface BulkRow {
  rowNumber: number;
  name: string;
  description: string;
  categoryName: string;
  categoryId: string | null;
  price: number | null;
  stock: number;
  sku: string;
  attributesText: string;
  imageUrl: string;
  slug: string;
  validationError: string | null;
  plannedStatus: PlannedStatus | null;
}

interface RowResult {
  rowNumber: number;
  name: string;
  outcome: PlannedStatus | "failed";
  reason: string | null;
}

const OUTCOME_LABEL: Record<PlannedStatus | "failed", string> = {
  published: "Published",
  submitted: "Submitted for review",
  draft: "Saved as draft",
  failed: "Failed",
};

const OUTCOME_COLOR: Record<PlannedStatus | "failed", string> = {
  published: "bg-emerald-100 text-emerald-800",
  submitted: "bg-blue-100 text-blue-800",
  draft: "bg-yellow-100 text-yellow-800",
  failed: "bg-red-100 text-red-800",
};

export function BulkUpload() {
  const { merchant, store } = useMerchant();
  const [featureEnabled, setFeatureEnabled] = useState(false);
  const [featureLoading, setFeatureLoading] = useState(true);
  const [categories, setCategories] = useState<Category[]>([]);
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<RowResult[] | null>(null);

  useEffect(() => {
    // Same admin-editable toggle Settings.tsx exposes (merchant_features.
    // bulk_upload_enabled) — platform-wide, not per-merchant (there is no
    // per-merchant override anywhere in this schema for any merchant_features
    // flag). Checked here too, not just at the nav-link level, so a direct
    // URL visit can't reach this page once Tolo turns the feature off.
    supabase
      .from("system_settings")
      .select("value")
      .eq("key", "merchant_features")
      .maybeSingle()
      .then(({ data }) => {
        const features = data?.value as { bulk_upload_enabled?: boolean } | null;
        setFeatureEnabled(features?.bulk_upload_enabled ?? false);
        setFeatureLoading(false);
      });
    supabase
      .from("categories")
      .select("id, name, slug")
      .eq("is_active", true)
      .then(({ data }) => setCategories(data ?? []));
  }, []);

  function handleDownloadTemplate() {
    const csv = buildCsv(TEMPLATE_HEADERS, TEMPLATE_EXAMPLE_ROWS);
    downloadCsv("tolo-bulk-product-template.csv", csv);
  }

  function validateRow(raw: Record<string, string>, rowNumber: number, usedSlugs: Set<string>): BulkRow {
    const name = raw.name?.trim() ?? "";
    const description = raw.description?.trim() ?? "";
    const categoryName = raw.category?.trim() ?? "";
    const priceRaw = raw.price?.trim() ?? "";
    const stockRaw = raw.stock?.trim() ?? "";
    const sku = raw.sku?.trim() ?? "";
    const attributesText = raw.attributes?.trim() ?? "";
    const imageUrl = raw.image_url?.trim() ?? "";

    let validationError: string | null = null;
    let categoryId: string | null = null;
    let price: number | null = null;
    let stock = 0;

    if (!name) {
      validationError = "Name is required.";
    }

    if (!validationError) {
      const parsedPrice = Number(priceRaw);
      if (!priceRaw || Number.isNaN(parsedPrice) || parsedPrice < 0) {
        validationError = "Price must be a non-negative number.";
      } else {
        price = parsedPrice;
      }
    }

    if (!validationError && stockRaw) {
      const parsedStock = Number(stockRaw);
      if (Number.isNaN(parsedStock) || parsedStock < 0 || !Number.isInteger(parsedStock)) {
        validationError = "Stock must be a non-negative whole number.";
      } else {
        stock = parsedStock;
      }
    }

    if (!validationError && categoryName) {
      const match = categories.find((c) => c.name.toLowerCase() === categoryName.toLowerCase());
      if (!match) {
        validationError = `Unknown category "${categoryName}".`;
      } else {
        categoryId = match.id;
      }
    }

    // Disambiguate duplicate names within the same file (products.slug is
    // unique per store) so two legitimately different rows that happen to
    // share a name don't fail on a unique-constraint violation when a
    // simple numeric suffix would resolve it cleanly.
    let slug = slugify(name || `row-${rowNumber}`);
    let suffix = 2;
    while (usedSlugs.has(slug)) {
      slug = `${slugify(name || `row-${rowNumber}`)}-${suffix}`;
      suffix++;
    }
    usedSlugs.add(slug);

    const plannedStatus: PlannedStatus | null = validationError
      ? null
      : isEligibleForListing(price!, stock)
        ? store?.status === "active"
          ? "published"
          : "submitted"
        : "draft";

    return {
      rowNumber,
      name,
      description,
      categoryName,
      categoryId,
      price,
      stock,
      sku,
      attributesText,
      imageUrl,
      slug,
      validationError,
      plannedStatus,
    };
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParseError(null);
    setResults(null);

    const text = await file.text();
    const objects = parseCsvToObjects(text);
    if (objects.length === 0) {
      setParseError("This file has no data rows — check it matches the template.");
      setRows([]);
      return;
    }

    const usedSlugs = new Set<string>();
    setRows(objects.map((raw, idx) => validateRow(raw, idx + 2, usedSlugs))); // +2: header is row 1
  }

  async function handleImport() {
    if (!merchant || !store || rows.length === 0) return;
    setImporting(true);
    const rowResults: RowResult[] = [];

    for (const row of rows) {
      if (row.validationError || !row.plannedStatus) {
        rowResults.push({ rowNumber: row.rowNumber, name: row.name, outcome: "failed", reason: row.validationError });
        continue;
      }

      const result = await saveProduct(
        {
          merchantId: merchant.id,
          storeId: store.id,
          categoryId: row.categoryId,
          name: row.name,
          slug: row.slug,
          description: row.description || null,
          basePrice: row.price!,
          status: row.plannedStatus,
        },
        [
          {
            sku: row.sku || null,
            attributes: parseAttributes(row.attributesText),
            price: row.price!,
            stock: row.stock,
            isDefault: true,
          },
        ],
        row.imageUrl ? [{ url: row.imageUrl }] : [],
      );

      if (result.ok) {
        rowResults.push({
          rowNumber: row.rowNumber,
          name: row.name,
          outcome: row.plannedStatus,
          reason: row.plannedStatus === "draft" ? LISTING_ELIGIBILITY_ERROR : null,
        });
      } else {
        rowResults.push({ rowNumber: row.rowNumber, name: row.name, outcome: "failed", reason: result.error });
      }
    }

    setResults(rowResults);
    setImporting(false);
  }

  if (featureLoading) return <p className="text-gray-500">Loading...</p>;

  if (!featureEnabled) {
    return (
      <div className="max-w-lg">
        <h1 className="text-xl font-bold mb-2">Bulk upload</h1>
        <p className="text-gray-600 text-sm">
          Bulk product upload isn't available on your account yet. Contact Tolo support if you'd like it enabled.
        </p>
        <Link to="/products" className="text-navy text-sm font-medium mt-4 inline-block">
          ← Back to products
        </Link>
      </div>
    );
  }

  if (!store) {
    return <p className="text-gray-600">Set up your store profile before bulk-uploading products. Go to Store Settings.</p>;
  }

  const validCount = rows.filter((r) => !r.validationError).length;

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">Bulk upload products</h1>
        <Link to="/products" className="text-navy text-sm font-medium">
          ← Back to products
        </Link>
      </div>

      <div className="bg-white border rounded-lg p-4 mb-4">
        <h2 className="font-medium text-sm mb-2">1. Download the template</h2>
        <p className="text-xs text-gray-500 mb-3">
          One row per product (a single variant each). <code>category</code> must match an existing category name exactly.{" "}
          <code>attributes</code> is optional, comma-separated <code>key:value</code> pairs (e.g. <code>color:Red, size:M</code>) — add more
          variants afterward from the product's own edit page if you need them.{" "}
          <code>image_url</code> is optional: paste a direct image link and it's attached as-is, the same as pasting a URL in the normal
          product form — nothing is re-uploaded or re-hosted.
        </p>
        <button onClick={handleDownloadTemplate} className="text-xs border px-3 py-1.5 rounded-md hover:bg-gray-50">
          ⬇ Download CSV template
        </button>
      </div>

      <div className="bg-white border rounded-lg p-4 mb-4">
        <h2 className="font-medium text-sm mb-2">2. Upload your CSV</h2>
        <input type="file" accept=".csv,text/csv" onChange={handleFileChange} className="text-sm" />
        {fileName && <p className="text-xs text-gray-500 mt-2">{fileName}</p>}
        {parseError && <p className="text-red-600 text-sm mt-2">{parseError}</p>}
      </div>

      {rows.length > 0 && !results && (
        <div className="bg-white border rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-medium text-sm">
              3. Review ({validCount} of {rows.length} row{rows.length === 1 ? "" : "s"} ready)
            </h2>
            <button
              onClick={handleImport}
              disabled={importing || validCount === 0}
              className="bg-navy text-white text-sm px-4 py-2 rounded-md hover:bg-navy-dark disabled:opacity-60"
            >
              {importing ? "Importing..." : `Import ${rows.length} row${rows.length === 1 ? "" : "s"}`}
            </button>
          </div>
          <div className="divide-y max-h-96 overflow-y-auto">
            {rows.map((r) => (
              <div key={r.rowNumber} className="py-2 flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium truncate">
                    Row {r.rowNumber}: {r.name || "(no name)"}
                  </p>
                  {r.validationError ? (
                    <p className="text-xs text-red-600">{r.validationError}</p>
                  ) : (
                    <p className="text-xs text-gray-500">
                      {r.categoryName || "Uncategorized"} · {r.price} ETB · stock {r.stock}
                    </p>
                  )}
                </div>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${
                    r.validationError
                      ? "bg-red-100 text-red-800"
                      : r.plannedStatus === "draft"
                        ? "bg-yellow-100 text-yellow-800"
                        : "bg-emerald-100 text-emerald-800"
                  }`}
                >
                  {r.validationError
                    ? "Invalid"
                    : r.plannedStatus === "published"
                      ? "Will publish"
                      : r.plannedStatus === "submitted"
                        ? "Will submit for review"
                        : "Will save as draft (below listing threshold)"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {results && (
        <div className="bg-white border rounded-lg p-4">
          <h2 className="font-medium text-sm mb-1">Import results</h2>
          <p className="text-xs text-gray-500 mb-3">
            {results.filter((r) => r.outcome !== "failed").length} of {results.length} row{results.length === 1 ? "" : "s"} created —
            partial success is normal, fix and re-upload just the failed rows if you want another pass.
          </p>
          <div className="divide-y">
            {results.map((r) => (
              <div key={r.rowNumber} className="py-2 flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium truncate">
                    Row {r.rowNumber}: {r.name || "(no name)"}
                  </p>
                  {r.reason && <p className="text-xs text-gray-500">{r.reason}</p>}
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${OUTCOME_COLOR[r.outcome]}`}>
                  {OUTCOME_LABEL[r.outcome]}
                </span>
              </div>
            ))}
          </div>
          <Link to="/products" className="text-navy text-sm font-medium mt-4 inline-block">
            View products →
          </Link>
        </div>
      )}
    </div>
  );
}
