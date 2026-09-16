import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useMerchant } from "../lib/MerchantContext";
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

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
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

  function parseAttributes(text: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    text
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((pair) => {
        const [k, v] = pair.split(":").map((s) => s.trim());
        if (k && v) attrs[k] = v;
      });
    return attrs;
  }

  async function handleSave(targetStatus: "draft" | "published" | "submitted") {
    if (!merchant || !store) return;
    if (!name.trim() || !basePrice) {
      setError("Name and base price are required.");
      return;
    }
    setSaving(true);
    setError(null);

    const payload = {
      merchant_id: merchant.id,
      store_id: store.id,
      category_id: categoryId || null,
      name: name.trim(),
      slug: slugify(name),
      description: description.trim() || null,
      base_price: Number(basePrice),
      status: targetStatus,
    };

    let productId = id;
    if (isNew) {
      const { data, error } = await supabase.from("products").insert(payload).select("id").single();
      if (error) {
        setError(error.message);
        setSaving(false);
        return;
      }
      productId = data.id;
    } else {
      const { error } = await supabase.from("products").update(payload).eq("id", id);
      if (error) {
        setError(error.message);
        setSaving(false);
        return;
      }
    }

    for (const v of variants) {
      if (!v.price.trim()) continue;
      const variantPayload = {
        product_id: productId,
        sku: v.sku || null,
        attributes: parseAttributes(v.attributesText),
        price: Number(v.price),
        is_default: variants.indexOf(v) === 0,
      };
      let variantId = v.id;
      if (variantId) {
        await supabase.from("product_variants").update(variantPayload).eq("id", variantId);
      } else {
        const { data } = await supabase.from("product_variants").insert(variantPayload).select("id").single();
        variantId = data?.id;
      }
      if (variantId) {
        await supabase
          .from("inventory")
          .upsert({ variant_id: variantId, stock_quantity: Number(v.stock) || 0 }, { onConflict: "variant_id" });
      }
    }

    for (const img of images) {
      if (!img.url.trim()) continue;
      if (img.id) {
        await supabase.from("product_images").update({ url: img.url }).eq("id", img.id);
      } else {
        await supabase
          .from("product_images")
          .insert({ product_id: productId, url: img.url, is_primary: images.indexOf(img) === 0 });
      }
    }

    setSaving(false);
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
        <input
          type="number"
          placeholder="Base price (ETB)"
          value={basePrice}
          onChange={(e) => setBasePrice(e.target.value)}
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
      </div>

      <div className="bg-white border rounded-lg p-4 mb-4">
        <div className="flex justify-between items-center mb-2">
          <h2 className="font-medium text-sm">Variants &amp; stock</h2>
          <button
            onClick={() => setVariants([...variants, { sku: "", attributesText: "", price: basePrice, stock: "0" }])}
            className="text-xs text-emerald-700 font-medium"
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
          <h2 className="font-medium text-sm">Images (URLs)</h2>
          <button onClick={() => setImages([...images, { url: "" }])} className="text-xs text-emerald-700 font-medium">
            + Add image
          </button>
        </div>
        {images.map((img, idx) => (
          <input
            key={idx}
            placeholder="https://..."
            value={img.url}
            onChange={(e) => {
              const next = [...images];
              next[idx] = { ...img, url: e.target.value };
              setImages(next);
            }}
            className="w-full border rounded-md px-2 py-1.5 text-sm mb-2"
          />
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
          className="bg-emerald-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-emerald-700 disabled:opacity-60"
        >
          {saving ? "Saving..." : "Publish"}
        </button>
      </div>
    </div>
  );
}
