import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast, useTranslation } from "@tolo/ui";
import { supabase } from "../lib/supabase";
import { useMerchant } from "../lib/MerchantContext";
import { isEligibleForListing, parseAttributes, slugify } from "../lib/productRules";
import { saveProduct } from "../lib/productWrites";
import type { Category, ProductVariant } from "../types";

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
}

export function ProductForm() {
  const { t } = useTranslation();
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

  async function handleImageUpload(idx: number, file: File) {
    if (!merchant) return;
    setUploadingImageIdx(idx);

    const path = `${merchant.id}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from("product-images").upload(path, file);

    setUploadingImageIdx(null);
    if (uploadError) {
      toast.error(t("productForm.imageUploadError"));
      return;
    }

    const { data } = supabase.storage.from("product-images").getPublicUrl(path);
    const next = [...images];
    next[idx] = { ...next[idx], url: data.publicUrl };
    setImages(next);
  }

  useEffect(() => {
    if (!merchant) return;
    const params = new URLSearchParams({ merchant_id: merchant.id });
    if (categoryId) params.set("category_id", categoryId);
    supabase.functions
      .invoke(`commission-calc?${params.toString()}`, { method: "GET" })
      .then(({ data }) => setCommissionRate(data?.rate_percent ?? null));
  }, [merchant, categoryId]);

  useEffect(() => {
    supabase.from("categories").select("id, name, slug").eq("is_active", true).then(({ data }) => setCategories(data ?? []));
  }, []);

  useEffect(() => {
    if (isNew) return;
    supabase
      .from("products")
      .select(
        `name, description, category_id, base_price,
         product_variants ( id, sku, attributes, price, inventory ( stock_quantity, low_stock_threshold ) ),
         product_images ( id, url )`,
      )
      .eq("id", id)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        setName(data.name);
        setDescription(data.description ?? "");
        setCategoryId(data.category_id ?? "");
        setBasePrice(String(data.base_price));
        const vs =
          (data.product_variants as unknown as (ProductVariant & {
            inventory: { stock_quantity: number; low_stock_threshold: number } | null;
          })[]) ?? [];
        if (vs.length > 0) {
          setVariants(
            vs.map((v) => ({
              id: v.id,
              sku: v.sku ?? "",
              attributesText: Object.entries(v.attributes ?? {})
                .map(([k, val]) => `${k}:${val}`)
                .join(", "),
              price: String(v.price),
              stock: String(v.inventory?.stock_quantity ?? 0),
              lowStockThreshold: String(v.inventory?.low_stock_threshold ?? 5),
            })),
          );
        }
        const imgs = (data.product_images as unknown as { id: string; url: string }[]) ?? [];
        if (imgs.length > 0) setImages(imgs.map((i) => ({ id: i.id, url: i.url })));
      });
  }, [id, isNew]);

  async function handleSave(targetStatus: "draft" | "published" | "submitted") {
    if (!merchant || !store) return;
    if (!name.trim() || !basePrice) {
      toast.error(t("productForm.nameRequired"));
      return;
    }

    // Blocking check on publish/submit only — a merchant must still be able
    // to save a work-in-progress draft regardless of stock/price. The
    // product needs every priced variant to individually qualify: there's
    // no way to hide just one non-qualifying variant while the rest of the
    // product stays listed, so one failing variant blocks the whole save.
    if (targetStatus !== "draft") {
      const pricedVariants = variants.filter((v) => v.price.trim());
      const allEligible =
        pricedVariants.length > 0 && pricedVariants.every((v) => isEligibleForListing(Number(v.price), Number(v.stock) || 0));
      if (!allEligible) {
        toast.error(t("productForm.eligibilityError"));
        return;
      }
    }

    setSaving(true);

    const result = await saveProduct(
      {
        merchantId: merchant.id,
        storeId: store.id,
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
    );

    setSaving(false);
    if (!result.ok) {
      toast.error(t("productForm.saveError"));
      return;
    }
    navigate("/products");
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-bold mb-4">{isNew ? t("productForm.newProductTitle") : t("productForm.editProductTitle")}</h1>

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
              {c.name}
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
          <div key={idx} className="grid grid-cols-5 gap-2 mb-2">
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
          </div>
        ))}
      </div>

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
    </div>
  );
}
