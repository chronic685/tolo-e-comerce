import { useEffect, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import { supabase } from "../lib/supabase";
import { EmptyState, toast } from "@tolo/ui";

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
    const path = `${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from("homepage-banners").upload(path, file);
    if (uploadError) {
      toast.error(uploadError.message);
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
      toast.error(error.message);
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
    if (!confirm("Delete this banner?")) return;
    const { error } = await supabase.from("homepage_banners").delete().eq("id", b.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setBanners((prev) => prev.filter((x) => x.id !== b.id));
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-bold mb-4">Homepage Banners</h1>

      <div className="bg-white border rounded-lg p-4 mb-4 space-y-2">
        <p className="font-medium text-sm">Add a banner</p>
        <input
          placeholder="Title (optional)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
        <input
          placeholder="Link URL (optional — e.g. /shops/some-shop)"
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          className="w-full border rounded-md px-3 py-2 text-sm"
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
          className="text-sm"
        />
        {uploading && <p className="text-xs text-gray-400">Uploading...</p>}
      </div>

      {loading ? null : banners.length === 0 ? (
        <EmptyState icon={ImageIcon} title="No banners yet" description="Add an image above to show it on the homepage." />
      ) : (
        <div className="bg-white border rounded-lg divide-y">
          {banners.map((b) => (
            <div key={b.id} className="flex items-center gap-3 p-3">
              <img src={b.image_url} alt={b.title ?? ""} className="w-24 h-14 object-cover rounded-md flex-shrink-0 bg-gray-100" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{b.title || "(untitled)"}</p>
                {b.link_url && <p className="text-xs text-gray-500 truncate">{b.link_url}</p>}
              </div>
              <input
                type="number"
                value={b.sort_order}
                onChange={(e) => updateSortOrder(b, Number(e.target.value))}
                className="w-16 border rounded-md px-2 py-1 text-sm flex-shrink-0"
                title="Display order"
              />
              <button
                onClick={() => toggleActive(b)}
                className={`text-xs px-2 py-1 rounded-full border flex-shrink-0 ${
                  b.is_active ? "bg-emerald-100 text-emerald-800 border-emerald-200" : "bg-gray-100 text-gray-600"
                }`}
              >
                {b.is_active ? "Active" : "Inactive"}
              </button>
              <button
                onClick={() => handleDelete(b)}
                className="text-xs text-red-600 border border-red-200 px-2 py-1 rounded-md hover:bg-red-50 flex-shrink-0"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
