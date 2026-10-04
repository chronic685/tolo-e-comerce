// Migration 0090 (merchants.category_id) against in-process PGlite -- see pglite/harness.ts.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./pglite/harness.ts";

const OWNERS = { exact: randomUUID(), spaced: randomUUID(), typo: randomUUID(), none: randomUUID() };
const CATEGORY_ID = randomUUID();

// Merchants that exist BEFORE the migration runs, as live data does.
const PRELUDE = /* sql */ `
insert into categories (id, name, slug) values ('${CATEGORY_ID}', 'Electronics', 'electronics');
insert into auth.users (id, email) values
  ('${OWNERS.exact}', 'a@test.local'), ('${OWNERS.spaced}', 'b@test.local'), ('${OWNERS.typo}', 'c@test.local'), ('${OWNERS.none}', 'd@test.local');
insert into profiles (id, role) values
  ('${OWNERS.exact}', 'merchant'), ('${OWNERS.spaced}', 'merchant'), ('${OWNERS.typo}', 'merchant'), ('${OWNERS.none}', 'merchant');
insert into merchants (owner_id, business_name, business_category) values
  ('${OWNERS.exact}', 'Exact', 'Electronics'),
  ('${OWNERS.spaced}', 'Spaced', '  electronics '),
  ('${OWNERS.typo}', 'Typo', 'cosmotics'),
  ('${OWNERS.none}', 'None', null);
`;

let h: Harness;

beforeAll(async () => {
  h = await createHarness(
    ["0072_tolo_phone_links.sql", "0073_merchant_applications.sql", "0074_merchant_application_licenses_storage.sql", "0075_merchant_application_approval.sql", "0090_merchant_category_id.sql"],
    { prelude: PRELUDE },
  );
});

async function merchant(name: string) {
  const { rows } = await h.db.query<{ category_id: string | null; business_category: string | null }>(
    "select category_id, business_category from merchants where business_name = $1",
    [name],
  );
  return rows[0];
}

describe("0090 backfill", () => {
  it("links a merchant whose old text exactly matches a category, ignoring case and spaces", async () => {
    expect((await merchant("Exact")).category_id).toBe(CATEGORY_ID);
    expect((await merchant("Spaced")).category_id).toBe(CATEGORY_ID);
  });

  it("leaves a typo or an empty value unlinked for an admin to confirm", async () => {
    expect((await merchant("Typo")).category_id).toBeNull();
    expect((await merchant("None")).category_id).toBeNull();
  });

  it("keeps the legacy text exactly as it was", async () => {
    expect((await merchant("Typo")).business_category).toBe("cosmotics");
    expect((await merchant("Spaced")).business_category).toBe("  electronics ");
  });
});

describe("category_id", () => {
  it("is set to null (not blocked) when its category is deleted", async () => {
    const id = randomUUID();
    await h.db.query("insert into categories (id, name, slug) values ($1, 'Temp', 'temp')", [id]);
    await h.db.query("update merchants set category_id = $1 where business_name = 'None'", [id]);
    await h.db.query("delete from categories where id = $1", [id]);
    expect((await merchant("None")).category_id).toBeNull();
  });
});
