import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  toast,
  translateServerError,
  useCategoryName,
  useTranslation,
} from "@tolo/ui";
import { merchantProducts, type ShopRef } from "../data/merchantProducts";
import { useMerchant } from "../lib/MerchantContext";
import { isEligibleForListing, parseAttributes, slugify } from "../lib/productRules";
import type { Category } from "../types";

interface VariantDraft {
  id?: string;
  sku: string;
  attributesText: string;
  price: string;
  stock: string;
  lowStockThreshold: string;
}

interface ImageDraft {
  id?: string;
  url: string;
  /** A picture chosen from this computer that the API backend uploads when the product is saved. */
  file?: File;
}

export function ProductForm() {
  const { t } = useTranslation();
  const categoryName = useCategoryName();
  const { id } = useParams();
  const isNew = id === "new";
  const { merchant, store } = useMerchant();
  const navigate = useNavigate();

  const [categories, setCategories] = useState<Category[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [basePrice, setBasePrice] = useState("");
  const [variants, setVariants] = useState<VariantDraft[]>([
    { sku: "", attributesText: "", price: "", stock: "0", lowStockThreshold: "5" },
  ]);
  const [images, setImages] = useState<ImageDraft[]>([{ url: "" }]);
  const [saving, setSaving] = useState(false);
  const [commissionRate, setCommissionRate] = useState<number | null>(null);
  const [uploadingImageIdx, setUploadingImageIdx] = useState<number | null>(null);
  // An existing product keeps its status when edited (a hidden product stays hidden, a live one stays
  // live); only a draft or a new product chooses one with the buttons below.
  const [currentStatus, setCurrentStatus] = useState<string | null>(null);
  const [archivedBy, setArchivedBy] = useState<"merchant" | "staff" | null>(null);
  const [removedVariantIds, setRemovedVariantIds] = useState<string[]>([]);
  const [removedImageIds, setRemovedImageIds] = useState<string[]>([]);
  const isArchived = currentStatus === "archived";

  // The shop the Supabase backend works for; the API backend finds the signed-in account's own shop.
  const shopRef: ShopRef | null = merchant && store ? { merchantId: merchant.id, storeId: store.id } : null;

  async function handleImageUpload(idx: number, file: File) {
    if (!shopRef) return;
    setUploadingImageIdx(idx);
    const result = await merchantProducts.prepareImage(shopRef, file);
    setUploadingImageIdx(null);
    if (!result.ok) {
      toast.error(result.prepareFailed ? t("images.prepareFailed") : translateServerError(result.error, t));
      return;
    }
    const next = [...images];
    next[idx] = { ...next[idx], url: result.url, file: result.file };
    setImages(next);
  }

  useEffect(() => {
    if (!shopRef) return;
    merchantProducts.commissionRate(shopRef, categoryId).then(setCommissionRate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchant, store, categoryId]);

  useEffect(() => {
    merchantProducts.categories().then(setCategories);
  }, []);

  useEffect(() => {
    if (isNew || !id) return;
    merchantProducts.load(id).then((p) => {
      if (!p) return;
      setName(p.name);
      setDescription(p.description ?? "");
      setCategoryId(p.categoryId ?? "");
      setBasePrice(String(p.basePrice));
      setCurrentStatus(p.status);
      setArchivedBy(p.archivedBy);
      if (p.variants.length > 0) {
        setVariants(
          p.variants.map((v) => ({
            id: v.id,
            sku: v.sku ?? "",
            attributesText: Object.entries(v.attributes ?? {})
              .map(([k, val]) => `${k}:${val}`)
              .join(", "),
            price: String(v.price),
            stock: String(v.stock),
            lowStockThreshold: String(v.lowStockThreshold),
          })),
        );
      }
      if (p.images.length > 0) setImages(p.images.map((i) => ({ id: i.id, url: i.url })));
    });
  }, [id, isNew]);

  async function handleSave(targetStatus: "draft" | "published" | "submitted" | "paused" | "approved") {
    if (!shopRef || isArchived) return;
    if (!name.trim() || !basePrice) {
      toast.error(t("productForm.nameRequired"));
      return;
    }

    // Blocking check on publish/submit only — a merchant must still be able
    // to save a work-in-progress draft regardless of stock/price. The
    // product needs every priced variant to individually qualify: there's
    // no way to hide just one non-qualifying variant while the rest of the
    // product stays listed, so one failing variant blocks the whole save.
    if (targetStatus === "published" || targetStatus === "submitted") {
      const pricedVariants = variants.filter((v) => v.price.trim());
      const allEligible =
        pricedVariants.length > 0 && pricedVariants.every((v) => isEligibleForListing(Number(v.price), Number(v.stock) || 0));
      if (!allEligible) {
        toast.error(t("productForm.eligibilityError"));
        return;
      }
    }

    setSaving(true);

    const result = await merchantProducts.save(
      shopRef,
      {
        categoryId: categoryId || null,
        name: name.trim(),
        slug: slugify(name),
        description: description.trim() || null,
        basePrice: Number(basePrice),
        status: targetStatus,
      },
      variants
        .filter((v) => v.price.trim())
        .map((v, idx) => ({
          id: v.id,
          sku: v.sku || null,
          attributes: parseAttributes(v.attributesText),
          price: Number(v.price),
          stock: Number(v.stock) || 0,
          isDefault: idx === 0,
          lowStockThreshold: v.lowStockThreshold.trim() ? Number(v.lowStockThreshold) : undefined,
        })),
      images,
      isNew ? undefined : id,
      { variantIds: removedVariantIds, imageIds: removedImageIds },
    );

    if (!result.ok) {
      setSaving(false);
      toast.error(result.variantInUse ? t("productForm.variantInUse") : translateServerError(result.error, t));
      return;
    }

    // The product is saved; say what could not be done with its pictures.
    for (const warning of result.warnings ?? []) toast.error(warning);
    setSaving(false);
    navigate("/products");
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-bold mb-4">{isNew ? t("productForm.newProductTitle") : t("productForm.editProductTitle")}</h1>

      {isArchived && (
        <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/40 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
          {archivedBy === "staff" ? t("productForm.archivedByAdminNotice") : t("productForm.archivedNotice")}
        </p>
      )}

      <fieldset disabled={isArchived} className="min-w-0 border-0 p-0 m-0">
      <div className="bg-white dark:bg-navy-dark border rounded-lg p-4 space-y-3 mb-4">
        <input
          placeholder={t("productForm.namePlaceholder")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
        <textarea
          placeholder={t("common.description")}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm">
          <option value="">{t("productForm.selectCategory")}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {categoryName(c)}
            </option>
          ))}
        </select>
        <div>
          <input
            type="number"
            placeholder={t("productForm.yourPrice")}
            value={basePrice}
            onChange={(e) => setBasePrice(e.target.value)}
            className="w-full border rounded-md px-3 py-2 text-sm"
          />
          {basePrice && commissionRate !== null && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {t("productForm.commissionNote", {
                basePrice: Number(basePrice).toFixed(2),
                customerPrice: (Number(basePrice) * (1 + commissionRate / 100)).toFixed(2),
                rate: commissionRate,
              })}
            </p>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-navy-dark border rounded-lg p-4 mb-4">
        <div className="flex justify-between items-center mb-2">
          <h2 className="font-medium text-sm">{t("productForm.variantsAndStock")}</h2>
          <button
            onClick={() => setVariants([...variants, { sku: "", attributesText: "", price: basePrice, stock: "0", lowStockThreshold: "5" }])}
            className="text-xs text-navy font-medium"
          >
            {t("productForm.addVariant")}
          </button>
        </div>
        {variants.map((v, idx) => (
          <div key={idx} className="grid grid-cols-[repeat(4,minmax(0,1fr))_auto] sm:grid-cols-[repeat(5,minmax(0,1fr))_auto] gap-2 mb-2 items-center">
            <input
              placeholder={t("productForm.attributesPlaceholder")}
              value={v.attributesText}
              onChange={(e) => {
                const next = [...variants];
                next[idx] = { ...v, attributesText: e.target.value };
                setVariants(next);
              }}
              className="border rounded-md px-2 py-1.5 text-sm col-span-2"
            />
            <input
              type="number"
              placeholder={t("common.price")}
              value={v.price}
              onChange={(e) => {
                const next = [...variants];
                next[idx] = { ...v, price: e.target.value };
                setVariants(next);
              }}
              className="border rounded-md px-2 py-1.5 text-sm"
            />
            <input
              type="number"
              placeholder={t("common.stock")}
              value={v.stock}
              onChange={(e) => {
                const next = [...variants];
                next[idx] = { ...v, stock: e.target.value };
                setVariants(next);
              }}
              className="border rounded-md px-2 py-1.5 text-sm"
            />
            <input
              type="number"
              min={0}
              placeholder={t("productForm.lowStockAlertAt")}
              title={t("productForm.lowStockAlertTooltip")}
              value={v.lowStockThreshold}
              onChange={(e) => {
                const next = [...variants];
                next[idx] = { ...v, lowStockThreshold: e.target.value };
                setVariants(next);
              }}
              className="border rounded-md px-2 py-1.5 text-sm"
            />
            <button
              type="button"
              disabled={variants.length === 1}
              title={t("productForm.removeVariant")}
              aria-label={t("productForm.removeVariant")}
              onClick={() => {
                if (v.id) setRemovedVariantIds((prev) => [...prev, v.id!]);
                setVariants(variants.filter((_, i) => i !== idx));
              }}
              className="text-gray-400 hover:text-red-600 disabled:opacity-30 disabled:hover:text-gray-400 px-1 text-lg leading-none"
            >
              ×
            </button>
          </div>
        ))}
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{t("productForm.lowStockAlertNote")}</p>
      </div>

      <div className="bg-white dark:bg-navy-dark border rounded-lg p-4 mb-4">
        <div className="flex justify-between items-center mb-2">
          <h2 className="font-medium text-sm">{t("productForm.productPhotos")}</h2>
          <button onClick={() => setImages([...images, { url: "" }])} className="text-xs text-navy font-medium">
            {t("productForm.addAnother")}
          </button>
        </div>
        {images.map((img, idx) => (
          <div key={idx} className="flex items-center gap-2 mb-2">
            {img.url && (
              <img src={img.url} alt="" className="w-12 h-12 object-cover rounded border flex-shrink-0" />
            )}
            <input
              placeholder={t("productForm.photoUrlPlaceholder")}
              value={img.url}
              onChange={(e) => {
                const next = [...images];
                next[idx] = { ...img, url: e.target.value };
                setImages(next);
              }}
              className="flex-1 border rounded-md px-2 py-1.5 text-sm"
            />
            <label className="text-xs text-gray-700 dark:text-gray-300 border rounded-md px-2 py-1.5 cursor-pointer hover:bg-gray-50 dark:bg-white/5 flex-shrink-0">
              {uploadingImageIdx === idx ? t("common.uploading") : t("productForm.upload")}
              <input
                type="file"
                accept=".jpg,.jpeg,.png,.webp"
                className="hidden"
                disabled={uploadingImageIdx !== null}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImageUpload(idx, file);
                }}
              />
            </label>
            <button
              type="button"
              title={t("productForm.removePhoto")}
              aria-label={t("productForm.removePhoto")}
              onClick={() => {
                if (img.id) setRemovedImageIds((prev) => [...prev, img.id!]);
                setImages(images.length === 1 ? [{ url: "" }] : images.filter((_, i) => i !== idx));
              }}
              className="text-gray-400 hover:text-red-600 px-1 text-lg leading-none flex-shrink-0"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      </fieldset>

      {isArchived ? null : !isNew && currentStatus && currentStatus !== "draft" ? (
        <div className="flex gap-2">
          <button
            onClick={() => handleSave(currentStatus as "published" | "submitted" | "paused" | "approved")}
            disabled={saving}
            className="bg-navy text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-navy-dark disabled:opacity-60"
          >
            {saving ? t("common.saving") : t("productForm.saveChanges")}
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={() => handleSave("draft")}
            disabled={saving}
            className="border px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-50 dark:bg-white/5 disabled:opacity-60"
          >
            {t("productForm.saveAsDraft")}
          </button>
          <button
            onClick={() => handleSave(store?.status === "active" ? "published" : "submitted")}
            disabled={saving}
            className="bg-navy text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-navy-dark disabled:opacity-60"
          >
            {saving ? t("common.saving") : t("merchantProducts.publish")}
          </button>
        </div>
      )}
    </div>
  );
}
