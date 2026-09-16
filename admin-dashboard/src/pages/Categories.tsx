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
        <button type="submit" className="bg-slate-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-slate-800">
          Add
        </button>
      </form>
      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      <div className="bg-white border rounded-lg divide-y">
        {categories.map((c) => (
          <div key={c.id} className="flex items-center justify-between p-3">
            <span className="text-sm">{c.name}</span>
            <button
              onClick={() => toggleActive(c)}
              className={`text-xs px-2 py-1 rounded-full border ${
                c.is_active ? "bg-emerald-100 text-emerald-800 border-emerald-200" : "bg-gray-100 text-gray-600"
              }`}
            >
              {c.is_active ? "Active" : "Inactive"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
