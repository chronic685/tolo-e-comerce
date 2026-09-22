import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Category } from "../types";

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function Categories() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  // How many products currently reference the category pending deletion —
  // fetched on demand so the confirmation can say "12 products will become
  // uncategorized" rather than a generic warning.
  const [deleteTarget, setDeleteTarget] = useState<{ category: Category; productCount: number } | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    const { data } = await supabase.from("categories").select("*").order("sort_order");
    setCategories(data ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    const { error } = await supabase.from("categories").insert({ name: newName.trim(), slug: slugify(newName) });
    if (error) {
      setError(error.message);
      return;
    }
    setNewName("");
    setError(null);
    await load();
  }

  async function toggleActive(c: Category) {
    await supabase.from("categories").update({ is_active: !c.is_active }).eq("id", c.id);
    await load();
  }

  function startEdit(c: Category) {
    setEditingId(c.id);
    setEditingName(c.name);
    setError(null);
  }

  async function handleRename(c: Category) {
    const name = editingName.trim();
    if (!name || name === c.name) {
      setEditingId(null);
      return;
    }
    // Products reference category_id, not the name/slug, so renaming never
    // touches or breaks their categorization — same as PricingRules.tsx's
    // own note that editing a rule only ever affects what resolves going
    // forward, nothing already in place.
    const { error } = await supabase.from("categories").update({ name, slug: slugify(name) }).eq("id", c.id);
    if (error) {
      setError(error.message);
      return;
    }
    setEditingId(null);
    setError(null);
    await load();
  }

  async function confirmDelete(c: Category) {
    const { count } = await supabase.from("products").select("id", { count: "exact", head: true }).eq("category_id", c.id);
    setDeleteTarget({ category: c, productCount: count ?? 0 });
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    // products.category_id is `on delete set null` (migration 0004) --
    // deleting the category never deletes or breaks the products that
    // referenced it, it just leaves them uncategorized, exactly like the
    // rest of this app's "set to null, don't delete the real data" pattern.
    const { error } = await supabase.from("categories").delete().eq("id", deleteTarget.category.id);
    setDeleting(false);
    if (error) {
      setError(error.message);
      setDeleteTarget(null);
      return;
    }
    setDeleteTarget(null);
    setError(null);
    await load();
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-xl font-bold mb-4">Categories</h1>

      <form onSubmit={handleAdd} className="flex gap-2 mb-4">
        <input
          placeholder="New category name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="flex-1 border rounded-md px-3 py-2 text-sm"
        />
        <button type="submit" className="bg-navy text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-navy-dark">
          Add
        </button>
      </form>
      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      <div className="bg-white border rounded-lg divide-y">
        {categories.map((c) => (
          <div key={c.id} className="flex items-center justify-between p-3 gap-2">
            {editingId === c.id ? (
              <input
                autoFocus
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRename(c);
                  if (e.key === "Escape") setEditingId(null);
                }}
                className="flex-1 border rounded-md px-2 py-1 text-sm"
              />
            ) : (
              <span className="text-sm">{c.name}</span>
            )}
            <div className="flex items-center gap-2 flex-shrink-0">
              {editingId === c.id ? (
                <>
                  <button onClick={() => handleRename(c)} className="text-xs text-navy font-medium">
                    Save
                  </button>
                  <button onClick={() => setEditingId(null)} className="text-xs text-gray-500">
                    Cancel
                  </button>
                </>
              ) : (
                <button onClick={() => startEdit(c)} className="text-xs border px-2 py-1 rounded-md hover:bg-gray-50">
                  Rename
                </button>
              )}
              <button
                onClick={() => toggleActive(c)}
                className={`text-xs px-2 py-1 rounded-full border ${
                  c.is_active ? "bg-emerald-100 text-emerald-800 border-emerald-200" : "bg-gray-100 text-gray-600"
                }`}
              >
                {c.is_active ? "Active" : "Inactive"}
              </button>
              <button onClick={() => confirmDelete(c)} className="text-xs text-red-600 border border-red-200 px-2 py-1 rounded-md hover:bg-red-50">
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-5 max-w-sm w-full">
            <h2 className="font-semibold mb-2">Delete "{deleteTarget.category.name}"?</h2>
            <p className="text-sm text-gray-600 mb-4">
              {deleteTarget.productCount > 0
                ? `${deleteTarget.productCount} product${deleteTarget.productCount === 1 ? "" : "s"} currently use this category — ${
                    deleteTarget.productCount === 1 ? "it" : "they"
                  } will become uncategorized, not deleted.`
                : "No products currently use this category."}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="text-sm border px-3 py-1.5 rounded-md hover:bg-gray-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="text-sm bg-red-600 text-white px-3 py-1.5 rounded-md hover:bg-red-700 disabled:opacity-60"
              >
                {deleting ? "Deleting..." : "Delete category"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
