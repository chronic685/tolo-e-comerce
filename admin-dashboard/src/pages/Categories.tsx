import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  ADMIN_PAGE_SIZE,
  Badge,
  Button,
  CATEGORY_COLORS,
  CATEGORY_ICON_NAMES,
  CategoryIcon,
  type CategoryColor,
  DataTable,
  Pagination,
  toast,
  totalPagesFor,
  translateServerError,
  usePagination,
  useTranslation,
  type DataTableColumn,
} from "@tolo/ui";
import type { Category } from "../types";

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const COLOR_LABEL_KEYS: Record<CategoryColor, string> = {
  navy: "adminCategories.color.navy",
  rose: "adminCategories.color.rose",
  amber: "adminCategories.color.amber",
  violet: "adminCategories.color.violet",
  emerald: "adminCategories.color.emerald",
  sky: "adminCategories.color.sky",
  teal: "adminCategories.color.teal",
  orange: "adminCategories.color.orange",
};

interface Draft {
  name: string;
  nameAm: string;
  icon: string;
  color: string;
}

export function Categories() {
  const { t } = useTranslation();
  const [categories, setCategories] = useState<Category[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const { page, from, to, setPage } = usePagination({ pageSize: ADMIN_PAGE_SIZE });
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ name: "", nameAm: "", icon: "tag", color: "navy" });
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
      toast.error(translateServerError(error.message, t));
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
    setDraft({ name: c.name, nameAm: c.name_am ?? "", icon: c.icon, color: c.color });
  }

  async function handleSave(c: Category) {
    const name = draft.name.trim();
    if (!name) return;
    const nameAm = draft.nameAm.trim() || null;
    // Products reference category_id, not the name/slug, so renaming never
    // touches or breaks their categorization — same as PricingRules.tsx's
    // own note that editing a rule only ever affects what resolves going
    // forward, nothing already in place. The slug only follows an actual rename.
    const changes = { name, name_am: nameAm, icon: draft.icon, color: draft.color, ...(name !== c.name ? { slug: slugify(name) } : {}) };
    const { error } = await supabase.from("categories").update(changes).eq("id", c.id);
    if (error) {
      toast.error(translateServerError(error.message, t));
      return;
    }
    setCategories((prev) => prev.map((cat) => (cat.id === c.id ? { ...cat, ...changes } : cat)));
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
      toast.error(translateServerError(error.message, t));
      setDeleteTarget(null);
      return;
    }
    await load();
    setDeleteTarget(null);
  }

  const columns: DataTableColumn<Category>[] = [
    {
      key: "name",
      header: t("common.name"),
      render: (c) =>
        editingId === c.id ? (
          <div className="space-y-2 min-w-[14rem]">
            <input
              autoFocus
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave(c);
                if (e.key === "Escape") setEditingId(null);
              }}
              className="w-full border rounded-md px-2 py-1 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
            />
            <input
              value={draft.nameAm}
              onChange={(e) => setDraft({ ...draft, nameAm: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave(c);
                if (e.key === "Escape") setEditingId(null);
              }}
              placeholder={t("adminCategories.nameAmPlaceholder")}
              aria-label={t("adminCategories.nameAm")}
              className="w-full border rounded-md px-2 py-1 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
            />
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t("adminCategories.icon")}</p>
              <div className="flex flex-wrap gap-1">
                {CATEGORY_ICON_NAMES.map((name) => (
                  <button
                    key={name}
                    type="button"
                    title={name}
                    aria-label={name}
                    aria-pressed={draft.icon === name}
                    onClick={() => setDraft({ ...draft, icon: name })}
                    className={`rounded-full p-0.5 border-2 ${draft.icon === name ? "border-navy dark:border-navy-light" : "border-transparent"}`}
                  >
                    <CategoryIcon icon={name} color={draft.color} />
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t("adminCategories.color")}</p>
              <div className="flex flex-wrap gap-1">
                {CATEGORY_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    title={t(COLOR_LABEL_KEYS[color])}
                    aria-label={t(COLOR_LABEL_KEYS[color])}
                    aria-pressed={draft.color === color}
                    onClick={() => setDraft({ ...draft, color })}
                    className={`rounded-full p-0.5 border-2 ${draft.color === color ? "border-navy dark:border-navy-light" : "border-transparent"}`}
                  >
                    <CategoryIcon icon="tag" color={color} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <CategoryIcon icon={c.icon} color={c.color} />
            <div>
              <p className="text-sm">{c.name}</p>
              {c.name_am && <p className="text-xs text-gray-500 dark:text-gray-400">{c.name_am}</p>}
            </div>
          </div>
        ),
      filterValue: (c) => c.name,
      sortValue: (c) => c.name,
      csvValue: (c) => c.name,
    },
    {
      key: "status",
      header: t("common.status"),
      render: (c) => <Badge variant={c.is_active ? "success" : "default"}>{c.is_active ? t("common.active") : t("common.inactive")}</Badge>,
      csvValue: (c) => (c.is_active ? "active" : "inactive"),
    },
    {
      key: "actions",
      header: "",
      render: (c) => (
        <div className="flex items-center gap-2 justify-end">
          {editingId === c.id ? (
            <>
              <Button size="sm" variant="outline" onClick={() => handleSave(c)}>
                {t("common.save")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                {t("common.cancel")}
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" onClick={() => startEdit(c)}>
              {t("adminCategories.edit")}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => toggleActive(c)}>
            {c.is_active ? t("banners.deactivate") : t("banners.activate")}
          </Button>
          <Button size="sm" variant="destructive" onClick={() => confirmDelete(c)}>
            {t("common.delete")}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-bold mb-4 dark:text-gray-100">{t("adminCategories.title")}</h1>

      <form onSubmit={handleAdd} className="flex gap-2 mb-4">
        <input
          placeholder={t("adminCategories.newCategoryPlaceholder")}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="flex-1 border rounded-md px-3 py-2 text-sm dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
        />
        <button type="submit" className="bg-navy dark:bg-navy-light text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-navy-dark dark:hover:bg-navy">
          {t("common.add")}
        </button>
      </form>

      <DataTable
        storageKey="admin.categories"
        columns={columns}
        rows={categories}
        getRowId={(c) => c.id}
        bulkActions={[
          { label: t("banners.activate"), onAction: (rows) => bulkToggle(rows, true) },
          { label: t("banners.deactivate"), onAction: (rows) => bulkToggle(rows, false), variant: "outline" },
        ]}
      />
      <div className="mt-4">
        <Pagination page={page} totalPages={totalPagesFor(totalCount, ADMIN_PAGE_SIZE)} onPageChange={setPage} />
      </div>

      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-navy-dark rounded-lg p-5 max-w-sm w-full">
            <h2 className="font-semibold mb-2 dark:text-gray-100">{t("adminCategories.deleteTitle", { name: deleteTarget.category.name })}</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              {deleteTarget.productCount > 0
                ? t("adminCategories.productsWillBeUncategorized", { count: deleteTarget.productCount })
                : t("adminCategories.noProductsUseCategory")}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="text-sm border dark:border-white/20 dark:text-gray-200 px-3 py-1.5 rounded-md hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-60"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="text-sm bg-red-600 text-white px-3 py-1.5 rounded-md hover:bg-red-700 disabled:opacity-60"
              >
                {deleting ? t("adminCategories.deleting") : t("adminCategories.deleteCategory")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
