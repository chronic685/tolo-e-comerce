import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useMerchant } from "../lib/MerchantContext";
import { isEligibleForListing, LISTING_ELIGIBILITY_ERROR, parseAttributes, slugify } from "../lib/productRules";
import { saveProduct } from "../lib/productWrites";
import type { Category, ProductVariant } from "../types";

interface VariantDraft {
  id?: string;
  sku: string;
  attributesText: string;
  price: string;
  stock: string;
}

interface ImageDraft {
  id?: string;
  url: string;
}

export function ProductForm() {
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
    { sku: "", attributesText: "", price: "", stock: "0" },
  ]);
  const [images, setImages] = useState<ImageDraft[]>([{ url: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [commissionRate, setCommissionRate] = useState<number | null>(null);
  const [uploadingImageIdx, setUploadingImageIdx] = useState<number | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  async function handleImageUpload(idx: number, file: File) {
    if (!merchant) return;
    setUploadingImageIdx(idx);
    setImageError(null);

    const path = `${merchant.id}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from("product-images").upload(path, file);

    setUploadingImageIdx(null);
    if (uploadError) {
      setImageError(uploadError.message);
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
         product_variants ( id, sku, attributes, price, inventory ( stock_quantity ) ),
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
        const vs = (data.product_variants as unknown as (ProductVariant & { inventory: { stock_quantity: number } | null })[]) ?? [];
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
      setError("Name and base price are required.");
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
        setError(LISTING_ELIGIBILITY_ERROR);
        return;
      }
    }

    setSaving(true);
    setError(null);

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
        })),
      images,
      isNew ? undefined : id,
    );

    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    navigate("/products");
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-bold mb-4">{isNew ? "New product" : "Edit product"}</h1>

      <div className="bg-white border rounded-lg p-4 space-y-3 mb-4">
        <input
          placeholder="Product name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
        <textarea
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm">
          <option value="">Select category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <div>
          <input
            type="number"
            placeholder="Your price (ETB)"
            value={basePrice}
            onChange={(e) => setBasePrice(e.target.value)}
            className="w-full border rounded-md px-3 py-2 text-sm"
          />
          {basePrice && commissionRate !== null && (
            <p className="text-xs text-gray-500 mt-1">
              You keep the full {Number(basePrice).toFixed(2)} ETB. Customers will pay{" "}
              {(Number(basePrice) * (1 + commissionRate / 100)).toFixed(2)} ETB (includes Tolo's {commissionRate}% commission).
            </p>
          )}
        </div>
      </div>

      <div className="bg-white border rounded-lg p-4 mb-4">
        <div className="flex justify-between items-center mb-2">
          <h2 className="font-medium text-sm">Variants &amp; stock</h2>
          <button
            onClick={() => setVariants([...variants, { sku: "", attributesText: "", price: basePrice, stock: "0" }])}
            className="text-xs text-navy font-medium"
          >
            + Add variant
          </button>
        </div>
        {variants.map((v, idx) => (
          <div key={idx} className="grid grid-cols-4 gap-2 mb-2">
            <input
              placeholder="Attributes (color:Red)"
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
              placeholder="Price"
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
              placeholder="Stock"
              value={v.stock}
              onChange={(e) => {
                const next = [...variants];
                next[idx] = { ...v, stock: e.target.value };
                setVariants(next);
              }}
              className="border rounded-md px-2 py-1.5 text-sm"
            />
          </div>
        ))}
      </div>

      <div className="bg-white border rounded-lg p-4 mb-4">
        <div className="flex justify-between items-center mb-2">
          <h2 className="font-medium text-sm">Product photos</h2>
          <button onClick={() => setImages([...images, { url: "" }])} className="text-xs text-navy font-medium">
            + Add another
          </button>
        </div>
        {imageError && <p className="text-red-600 text-xs mb-2">{imageError}</p>}
        {images.map((img, idx) => (
          <div key={idx} className="flex items-center gap-2 mb-2">
            {img.url && (
              <img src={img.url} alt="" className="w-12 h-12 object-cover rounded border flex-shrink-0" />
            )}
            <input
              placeholder="Photo URL, or upload a file →"
              value={img.url}
              onChange={(e) => {
                const next = [...images];
                next[idx] = { ...img, url: e.target.value };
                setImages(next);
              }}
              className="flex-1 border rounded-md px-2 py-1.5 text-sm"
            />
            <label className="text-xs text-gray-700 border rounded-md px-2 py-1.5 cursor-pointer hover:bg-gray-50 flex-shrink-0">
              {uploadingImageIdx === idx ? "Uploading..." : "Upload"}
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

      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={() => handleSave("draft")}
          disabled={saving}
          className="border px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-50 disabled:opacity-60"
        >
          Save as draft
        </button>
        <button
          onClick={() => handleSave(store?.status === "active" ? "published" : "submitted")}
          disabled={saving}
          className="bg-navy text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-navy-dark disabled:opacity-60"
        >
          {saving ? "Saving..." : "Publish"}
        </button>
      </div>
    </div>
  );
}
