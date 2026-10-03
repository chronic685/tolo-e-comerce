import { useEffect, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import { supabase } from "../lib/supabase";
import {
  Badge,
  Button,
  DataTable,
  type DataTableColumn,
  EmptyState,
  compressImage,
  PRODUCT_IMAGE_PRESET,
  toast,
  translateServerError,
  useTranslation,
} from "@tolo/ui";

interface Banner {
  id: string;
  image_url: string;
  link_url: string | null;
  title: string | null;
  is_active: boolean;
  sort_order: number;
}

// Group 4, item 18: nothing shows on Marketplace.tsx's homepage today
// besides the filter bar and product grid -- this lets an admin manage a
// small ordered list of promotional images (migration 0068). Public-read
// RLS means Marketplace.tsx can query homepage_banners directly with no
// dedicated public endpoint.
export function Banners() {
  const { t } = useTranslation();
  const [banners, setBanners] = useState<Banner[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [uploading, setUploading] = useState(false);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("homepage_banners").select("*").order("sort_order").order("created_at");
    setBanners((data as Banner[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleAdd(file: File) {
    setUploading(true);
    let prepared: File;
    try {
      prepared = await compressImage(file, PRODUCT_IMAGE_PRESET);
    } catch {
      toast.error(t("images.prepareFailed"));
      setUploading(false);
      return;
    }
    const path = `${Date.now()}-${prepared.name}`;
    const { error: uploadError } = await supabase.storage.from("homepage-banners").upload(path, prepared);
    if (uploadError) {
      toast.error(translateServerError(uploadError.message, t));
      setUploading(false);
      return;
    }
    const { data: publicUrl } = supabase.storage.from("homepage-banners").getPublicUrl(path);
    const nextSortOrder = banners.length > 0 ? Math.max(...banners.map((b) => b.sort_order)) + 1 : 0;

    const { error } = await supabase.from("homepage_banners").insert({
      image_url: publicUrl.publicUrl,
      title: title.trim() || null,
      link_url: linkUrl.trim() || null,
      sort_order: nextSortOrder,
    });
    setUploading(false);
    if (error) {
      toast.error(translateServerError(error.message, t));
      return;
    }
    setTitle("");
    setLinkUrl("");
    await load();
  }

  async function toggleActive(b: Banner) {
    const { error } = await supabase.from("homepage_banners").update({ is_active: !b.is_active }).eq("id", b.id);
    if (error) return;
    setBanners((prev) => prev.map((x) => (x.id === b.id ? { ...x, is_active: !x.is_active } : x)));
  }

  async function updateSortOrder(b: Banner, sortOrder: number) {
    const { error } = await supabase.from("homepage_banners").update({ sort_order: sortOrder }).eq("id", b.id);
    if (error) return;
    setBanners((prev) => prev.map((x) => (x.id === b.id ? { ...x, sort_order: sortOrder } : x)).sort((a, c) => a.sort_order - c.sort_order));
  }

  async function handleDelete(b: Banner) {
    if (!confirm(t("banners.deleteConfirm"))) return;
    const { error } = await supabase.from("homepage_banners").delete().eq("id", b.id);
    if (error) {
      toast.error(translateServerError(error.message, t));
      return;
    }
    setBanners((prev) => prev.filter((x) => x.id !== b.id));
  }

  const columns: DataTableColumn<Banner>[] = [
    {
      key: "banner",
      header: t("banners.column"),
      render: (b) => (
        <div className="flex items-center gap-3">
          <img src={b.image_url} alt={b.title ?? ""} className="w-24 h-14 object-cover rounded-md flex-shrink-0 bg-gray-100 dark:bg-white/5" />
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{b.title || t("banners.untitled")}</p>
            {b.link_url && <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{b.link_url}</p>}
          </div>
        </div>
      ),
      filterValue: (b) => b.title ?? "",
      csvValue: (b) => b.title ?? "",
    },
    {
      key: "sort_order",
      header: t("banners.orderColumn"),
      render: (b) => (
        <input
          type="number"
          value={b.sort_order}
          onChange={(e) => updateSortOrder(b, Number(e.target.value))}
          className="w-16 border rounded-md px-2 py-1 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
          title={t("banners.displayOrderTooltip")}
        />
      ),
      sortValue: (b) => b.sort_order,
      csvValue: (b) => b.sort_order,
    },
    {
      key: "status",
      header: t("common.status"),
      render: (b) => <Badge variant={b.is_active ? "success" : "default"}>{b.is_active ? t("common.active") : t("common.inactive")}</Badge>,
      csvValue: (b) => (b.is_active ? "active" : "inactive"),
    },
    {
      key: "actions",
      header: "",
      render: (b) => (
        <div className="flex items-center gap-2 justify-end">
          <Button size="sm" variant="outline" onClick={() => toggleActive(b)}>
            {b.is_active ? t("banners.deactivate") : t("banners.activate")}
          </Button>
          <Button size="sm" variant="destructive" onClick={() => handleDelete(b)}>
            {t("common.delete")}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-bold mb-4 dark:text-gray-100">{t("nav.banners")}</h1>

      <div className="bg-white dark:bg-navy-dark border dark:border-white/10 rounded-lg p-4 mb-4 space-y-2">
        <p className="font-medium text-sm dark:text-gray-100">{t("banners.addBanner")}</p>
        <input
          placeholder={t("banners.titlePlaceholder")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full border rounded-md px-3 py-2 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
        />
        <input
          placeholder={t("banners.linkUrlPlaceholder")}
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          className="w-full border rounded-md px-3 py-2 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
        />
        <input
          type="file"
          accept="image/*"
          disabled={uploading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleAdd(file);
            e.target.value = "";
          }}
          className="text-sm dark:text-gray-300"
        />
        {uploading && <p className="text-xs text-gray-400 dark:text-gray-500">{t("common.uploading")}</p>}
      </div>

      {loading ? null : banners.length === 0 ? (
        <EmptyState icon={ImageIcon} title={t("emptyState.noBanners")} description={t("emptyState.noBannersDescription")} />
      ) : (
        <DataTable storageKey="admin.banners" columns={columns} rows={banners} getRowId={(b) => b.id} />
      )}
    </div>
  );
}
