// Migration 0089 (category Amharic names, icons, colors) run for real against
// in-process PGlite -- see pglite/harness.ts. Never touches any Supabase project.
import { beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./pglite/harness.ts";

// The harness already stubs categories (0003) with the columns used here; seed the five live slugs plus one extra.
const PRELUDE = /* sql */ `
insert into categories (name, slug) values
  ('Fashion', 'fashion'), ('Home & Living', 'home-living'), ('Beauty & Health', 'beauty-health'),
  ('Groceries', 'groceries'), ('Electronics', 'electronics'), ('Toys', 'toys');
`;

let h: Harness;

beforeAll(async () => {
  h = await createHarness(["0089_category_translations_and_icons.sql"], { prelude: PRELUDE });
});

async function category(slug: string) {
  const { rows } = await h.db.query<{ name_am: string | null; icon: string; color: string }>("select name_am, icon, color from categories where slug = $1", [slug]);
  return rows[0];
}

describe("0089 category icons and Amharic names", () => {
  it("gives each seeded category its Amharic name, icon and color", async () => {
    expect(await category("fashion")).toEqual({ name_am: "ፋሽን", icon: "shirt", color: "rose" });
    expect(await category("groceries")).toEqual({ name_am: "የምግብ ሸቀጦች", icon: "shopping-basket", color: "emerald" });
    expect(await category("electronics")).toEqual({ name_am: "ኤሌክትሮኒክስ", icon: "smartphone", color: "sky" });
    expect((await category("home-living")).icon).toBe("sofa");
    expect((await category("beauty-health")).icon).toBe("sparkles");
  });

  it("gives every seeded category a distinct color", async () => {
    const { rows } = await h.db.query<{ color: string }>("select distinct color from categories where slug <> 'toys'");
    expect(rows).toHaveLength(5);
  });

  it("leaves a category it has no default for with no Amharic name, a generic icon and the brand color", async () => {
    expect(await category("toys")).toEqual({ name_am: null, icon: "tag", color: "navy" });
  });

  it("only accepts a color from the palette", async () => {
    await expect(h.db.query("update categories set color = 'hotpink' where slug = 'toys'")).rejects.toThrow(/categories_color_check/);
    await h.db.query("update categories set color = 'teal' where slug = 'toys'");
    expect((await category("toys")).color).toBe("teal");
  });
});
