import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { ADMIN_PAGE_SIZE, Badge, Button, DataTable, Pagination, toast, totalPagesFor, usePagination, type DataTableColumn } from "@tolo/ui";
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
  const [totalCount, setTotalCount] = useState(0);
  const { page, from, to, setPage } = usePagination({ pageSize: ADMIN_PAGE_SIZE });
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  // How many products currently reference the category pending deletion —
  // fetched on demand so the confirmation can say "12 products will become
  // uncategorized" rather than a generic warning.
  const [deleteTarget, setDeleteTarget] = useState<{ category: Category; productCount: number } | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    const { data, count } = await supabase.from("categories").select("*", { count: "exact" }).order("sort_order").range(from, to);
    setCategories(data ?? []);
    setTotalCount(count ?? 0);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    const { error } = await supabase.from("categories").insert({ name: newName.trim(), slug: slugify(newName) });
    if (error) {
      toast.error(error.message);
      return;
    }
    // Reloads rather than appending locally, now that the list is
    // paginated -- a new row sorts by sort_order, not necessarily onto the
    // page currently showing.
    await load();
    setNewName("");
  }

  async function toggleActive(c: Category) {
    const { error } = await supabase.from("categories").update({ is_active: !c.is_active }).eq("id", c.id);
    if (error) return;
    setCategories((prev) => prev.map((cat) => (cat.id === c.id ? { ...cat, is_active: !cat.is_active } : cat)));
  }

  async function bulkToggle(rows: Category[], makeActive: boolean) {
    const targets = rows.filter((c) => c.is_active !== makeActive);
    if (targets.length === 0) return;
    await supabase.from("categories").update({ is_active: makeActive }).in("id", targets.map((c) => c.id));
    setCategories((prev) => prev.map((c) => (targets.some((t) => t.id === c.id) ? { ...c, is_active: makeActive } : c)));
  }

  function startEdit(c: Category) {
    setEditingId(c.id);
    setEditingName(c.name);
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
      toast.error(error.message);
      return;
    }
    setCategories((prev) => prev.map((cat) => (cat.id === c.id ? { ...cat, name, slug: slugify(name) } : cat)));
    setEditingId(null);
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
      toast.error(error.message);
      setDeleteTarget(null);
      return;
    }
    await load();
    setDeleteTarget(null);
  }

  const columns: DataTableColumn<Category>[] = [
    {
      key: "name",
      header: "Name",
      render: (c) =>
        editingId === c.id ? (
          <input
            autoFocus
            value={editingName}
            onChange={(e) => setEditingName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRename(c);
              if (e.key === "Escape") setEditingId(null);
            }}
            className="border rounded-md px-2 py-1 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
          />
        ) : (
          <span className="text-sm">{c.name}</span>
        ),
      filterValue: (c) => c.name,
      sortValue: (c) => c.name,
      csvValue: (c) => c.name,
    },
    {
      key: "status",
      header: "Status",
      render: (c) => <Badge variant={c.is_active ? "success" : "default"}>{c.is_active ? "Active" : "Inactive"}</Badge>,
      csvValue: (c) => (c.is_active ? "active" : "inactive"),
    },
    {
      key: "actions",
      header: "",
      render: (c) => (
        <div className="flex items-center gap-2 justify-end">
          {editingId === c.id ? (
            <>
              <Button size="sm" variant="outline" onClick={() => handleRename(c)}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" onClick={() => startEdit(c)}>
              Rename
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => toggleActive(c)}>
            {c.is_active ? "Deactivate" : "Activate"}
          </Button>
          <Button size="sm" variant="destructive" onClick={() => confirmDelete(c)}>
            Delete
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="max-w-lg">
      <h1 className="text-xl font-bold mb-4 dark:text-gray-100">Categories</h1>

      <form onSubmit={handleAdd} className="flex gap-2 mb-4">
        <input
          placeholder="New category name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="flex-1 border rounded-md px-3 py-2 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
        />
        <button type="submit" className="bg-navy dark:bg-navy-light text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-navy-dark dark:hover:bg-navy">
          Add
        </button>
      </form>

      <DataTable
        storageKey="admin.categories"
        columns={columns}
        rows={categories}
        getRowId={(c) => c.id}
        bulkActions={[
          { label: "Activate", onAction: (rows) => bulkToggle(rows, true) },
          { label: "Deactivate", onAction: (rows) => bulkToggle(rows, false), variant: "outline" },
        ]}
      />
      <div className="mt-4">
        <Pagination page={page} totalPages={totalPagesFor(totalCount, ADMIN_PAGE_SIZE)} onPageChange={setPage} />
      </div>

      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-navy-dark rounded-lg p-5 max-w-sm w-full">
            <h2 className="font-semibold mb-2 dark:text-gray-100">Delete "{deleteTarget.category.name}"?</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
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
                className="text-sm border dark:border-white/20 dark:text-gray-200 px-3 py-1.5 rounded-md hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-60"
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
