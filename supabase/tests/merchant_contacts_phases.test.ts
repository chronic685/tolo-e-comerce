// The two-phase rollout of private merchant contacts, against in-process PGlite (see pglite/harness.ts):
//   0099 EXPAND  : additive. Old code (reads and writes merchants.phone ...) and new code (merchant_private) both work, in any deploy order.
//   0100 CONTRACT: apply only once all code is deployed. The old columns go and the exposure closes.
// Never touches any Supabase project.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { ADMIN_PRELUDE } from "./pglite/adminPrelude.ts";
import { createHarness, type Harness, type TestUser } from "./pglite/harness.ts";

const BASE = [
  "0072_tolo_phone_links.sql",
  "0073_merchant_applications.sql",
  "0074_merchant_application_licenses_storage.sql",
  "0075_merchant_application_approval.sql",
  "0090_merchant_category_id.sql",
  "0093_merchant_source_and_review_guard.sql",
  "0094_merchant_tin.sql",
];
const EXPAND = "0099_expand_merchant_private_and_admin_controls.sql";
const CONTRACT = "0100_contract_drop_public_merchant_contacts.sql";
const SENSITIVE = ["phone", "email", "owner_full_name", "owner_phone", "owner_email", "business_registration_number"];

const OLD_OWNER = randomUUID();
// A merchant that exists BEFORE the expand migration runs, as live data does.
const PRELUDE = `${ADMIN_PRELUDE}
insert into auth.users (id, email) values ('${OLD_OWNER}', 'old@test.local');
insert into profiles (id, role) values ('${OLD_OWNER}', 'merchant');
insert into merchants (id, owner_id, business_name, status, phone, email, owner_full_name, business_registration_number)
  values ('${OLD_OWNER}', '${OLD_OWNER}', 'Pre-existing Shop', 'active', '+251911000001', 'old@shop.test', 'Old Owner', 'REG-1');
`;

async function setup(migrations: string[]) {
  const h = await createHarness([...BASE, ...migrations], { prelude: PRELUDE });
  const owner = await h.createUser();
  const staff = await h.createUser({ role: "tolo_ops" });
  await h.db.query(`update profiles set permissions = '["merchants"]' where id = $1`, [staff.id]);
  const admin = await h.createUser({ adminTier: "admin" });
  return { h, owner, staff, admin };
}

async function merchantWithOldCode(h: Harness, owner: TestUser, name = "Old-code Shop") {
  // What the deployed merchant dashboard does today: one insert carrying the contact columns.
  const id = randomUUID();
  await h.db.query("insert into merchants (id, owner_id, business_name, status, phone, email, owner_full_name) values ($1, $2, $3, 'active', '+251911222333', 'shop@mail.test', 'Owner')", [id, owner.id, name]);
  return id;
}

const row = async (h: Harness, sql: string, params: unknown[]) => (await h.db.query<Record<string, string | null>>(sql, params)).rows[0];

describe("phase 1: expand (0099) -- old code and new code both work", () => {
  let h: Harness;
  let owner: TestUser;
  let staff: TestUser;
  let admin: TestUser;

  beforeAll(async () => {
    ({ h, owner, staff, admin } = await setup([EXPAND]));
  });

  it("deletes and revokes nothing: the old columns are all still on merchants", async () => {
    const { rows } = await h.db.query<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'merchants' and column_name = any($1)", [SENSITIVE]);
    expect(rows.map((r) => r.column_name).sort()).toEqual([...SENSITIVE].sort());
  });

  it("backfills a merchant that existed before the migration", async () => {
    expect(await row(h, "select phone, email, owner_full_name, business_registration_number from merchant_private where merchant_id = $1", [OLD_OWNER])).toEqual({
      phone: "+251911000001",
      email: "old@shop.test",
      owner_full_name: "Old Owner",
      business_registration_number: "REG-1",
    });
  });

  it("OLD code: writing the contact columns on merchants shows up in merchant_private", async () => {
    const id = await merchantWithOldCode(h, owner);
    expect(await row(h, "select phone, email from merchant_private where merchant_id = $1", [id])).toEqual({ phone: "+251911222333", email: "shop@mail.test" });
    await h.db.query("update merchants set phone = '+251900999888' where id = $1", [id]);
    expect((await row(h, "select phone from merchant_private where merchant_id = $1", [id])).phone).toBe("+251900999888");
  });

  it("NEW code: writing merchant_private shows up in the old columns, so old readers still see it", async () => {
    const id = randomUUID();
    await h.db.query("insert into merchants (id, owner_id, business_name, status) values ($1, $2, 'New-code Shop', 'active')", [id, owner.id]);
    // An upsert, which is what the new code does: during the expand phase inserting the merchant already created its (empty) private row.
    await h.db.query("insert into merchant_private (merchant_id, phone, email) values ($1, '+251911555666', 'new@shop.test') on conflict (merchant_id) do update set phone = excluded.phone, email = excluded.email", [id]);
    expect(await row(h, "select phone, email from merchants where id = $1", [id])).toEqual({ phone: "+251911555666", email: "new@shop.test" });
    await h.db.query("update merchant_private set email = 'changed@shop.test' where merchant_id = $1", [id]);
    expect((await row(h, "select email from merchants where id = $1", [id])).email).toBe("changed@shop.test");
  });

  it("the copy does not loop or touch unrelated rows", async () => {
    const a = await merchantWithOldCode(h, owner, "A");
    const b = await merchantWithOldCode(h, owner, "B");
    await h.db.query("update merchant_private set phone = '+251900111000' where merchant_id = $1", [a]);
    expect((await row(h, "select phone from merchants where id = $1", [a])).phone).toBe("+251900111000");
    expect((await row(h, "select phone from merchants where id = $1", [b])).phone).toBe("+251911222333");
  });

  it("keeps the staff rule on both sides: Merchants-page staff cannot change a phone number, through either table", async () => {
    const id = await merchantWithOldCode(h, owner);
    await h.db.query("create policy staff_update on merchants for update using (has_admin_page(array['merchants']))");
    await expect(h.asUser(staff.id, (tx) => tx.query("update merchants set phone = '+251900000000' where id = $1", [id]))).rejects.toThrow(/Only an admin or super admin/);
    await expect(h.asUser(staff.id, (tx) => tx.query("update merchant_private set phone = '+251900000000' where merchant_id = $1", [id]))).rejects.toThrow(/Only an admin or super admin/);
    await h.asUser(admin.id, (tx) => tx.query("update merchant_private set phone = '+251900000001' where merchant_id = $1", [id]));
    expect((await row(h, "select phone from merchants where id = $1", [id])).phone).toBe("+251900000001");
  });

  it("the approval flow of the old code path still works and fills merchant_private", async () => {
    const category = await h.createCategory();
    const applicant = await h.createUser();
    const app = (await h.asUser(applicant.id, (tx) => tx.query<{ id: string }>("select id from submit_merchant_application('Cafe', $1, 'Bole, Addis Ababa', '4440001112')", [category]))).rows[0];
    const merchantId = (await h.asService((tx) => tx.query<{ m: string }>("select approve_merchant_application($1, $2, $3, null) as m", [app.id, applicant.id, admin.id]))).rows[0].m;
    expect((await row(h, "select phone from merchant_private where merchant_id = $1", [merchantId])).phone).toBe(applicant.phone);
  });

  it("adds the safe public view: active merchants only, and none of the private columns", async () => {
    const inactive = randomUUID();
    await h.db.query("insert into merchants (id, owner_id, business_name, status) values ($1, $2, 'Not Active', 'registered')", [inactive, owner.id]);
    const { rows } = await h.asAnon((tx) => tx.query<Record<string, unknown>>("select * from merchants_public"));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) for (const column of SENSITIVE) expect(Object.keys(r)).not.toContain(column);
    expect(rows.some((r) => r.id === inactive)).toBe(false);
  });

  it("does NOT close the exposure yet (that is the contract phase): an anonymous visitor can still read the old columns", async () => {
    const id = await merchantWithOldCode(h, owner);
    const { rows } = await h.asAnon((tx) => tx.query<{ phone: string }>("select phone from merchants where id = $1", [id]));
    expect(rows).toEqual([{ phone: "+251911222333" }]);
  });

  it("already keeps merchant_private itself private", async () => {
    const id = await merchantWithOldCode(h, owner);
    await expect(h.asAnon((tx) => tx.query("select phone from merchant_private where merchant_id = $1", [id]))).rejects.toThrow(/permission denied/);
    const customer = await h.createUser();
    expect((await h.asUser(customer.id, (tx) => tx.query("select phone from merchant_private where merchant_id = $1", [id]))).rows).toEqual([]);
  });
});

describe("phase 2: contract (0100) -- the exposure is closed", () => {
  let h: Harness;
  let owner: TestUser;
  let admin: TestUser;

  beforeAll(async () => {
    ({ h, owner, admin } = await setup([EXPAND, CONTRACT]));
  });

  it("an anonymous visitor can read none of the sensitive fields from merchants, by name or through select *", async () => {
    const id = randomUUID();
    await h.db.query("insert into merchants (id, owner_id, business_name, status) values ($1, $2, 'Contract Shop', 'active')", [id, owner.id]);
    await h.db.query("insert into merchant_private (merchant_id, phone, email, owner_full_name, owner_phone, owner_email, business_registration_number) values ($1, '+251911222333', 's@mail.test', 'Owner', '+251911000111', 'o@mail.test', 'REG-9')", [id]);
    for (const column of SENSITIVE) {
      await expect(h.asAnon((tx) => tx.query(`select ${column} from merchants where id = $1`, [id])), column).rejects.toThrow(/does not exist/);
    }
    const wide = await h.asAnon((tx) => tx.query<Record<string, unknown>>("select * from merchants where id = $1", [id]));
    expect(wide.rows).toHaveLength(1);
    expect(Object.keys(wide.rows[0]).filter((k) => SENSITIVE.includes(k))).toEqual([]);
    for (const value of ["+251911222333", "s@mail.test", "Owner", "REG-9"]) expect(JSON.stringify(wide.rows[0])).not.toContain(value);
    // ...nor through the private table, nor the view.
    await expect(h.asAnon((tx) => tx.query("select * from merchant_private"))).rejects.toThrow(/permission denied/);
    const view = await h.asAnon((tx) => tx.query<Record<string, unknown>>("select * from merchants_public where id = $1", [id]));
    expect(Object.keys(view.rows[0]).filter((k) => SENSITIVE.includes(k))).toEqual([]);
  });

  it("a signed-in customer reads none of them either", async () => {
    const customer = await h.createUser();
    const { rows } = await h.asUser(customer.id, (tx) => tx.query<Record<string, unknown>>("select * from merchants where status = 'active'"));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(Object.keys(r).filter((k) => SENSITIVE.includes(k))).toEqual([]);
    expect((await h.asUser(customer.id, (tx) => tx.query("select * from merchant_private"))).rows).toEqual([]);
  });

  it("drops the sync triggers: merchant_private is now the only home of those fields", async () => {
    const { rows } = await h.db.query<{ tgname: string }>("select tgname from pg_trigger where tgname in ('merchants_sync_to_private', 'merchant_private_sync_to_merchants')");
    expect(rows).toEqual([]);
  });

  it("still reads and edits contacts for the owner and admin, and approval writes merchant_private directly", async () => {
    const id = randomUUID();
    await h.db.query("insert into merchants (id, owner_id, business_name, status) values ($1, $2, 'Owner Shop', 'active')", [id, owner.id]);
    await h.db.query("insert into merchant_private (merchant_id, phone) values ($1, '+251911000777')", [id]);
    expect((await h.asUser(owner.id, (tx) => tx.query<{ phone: string }>("select phone from merchant_private where merchant_id = $1", [id]))).rows).toEqual([{ phone: "+251911000777" }]);
    await h.asUser(admin.id, (tx) => tx.query("update merchant_private set phone = '+251911000778' where merchant_id = $1", [id]));

    const category = await h.createCategory();
    const applicant = await h.createUser();
    const app = (await h.asUser(applicant.id, (tx) => tx.query<{ id: string }>("select id from submit_merchant_application('Cafe', $1, 'Bole, Addis Ababa', '6660001112')", [category]))).rows[0];
    const merchantId = (await h.asService((tx) => tx.query<{ m: string }>("select approve_merchant_application($1, $2, $3, null) as m", [app.id, applicant.id, admin.id]))).rows[0].m;
    expect((await row(h, "select phone from merchant_private where merchant_id = $1", [merchantId])).phone).toBe(applicant.phone);
  });
});

describe("the contract migration is clearly marked", () => {
  it("says, at the top, to apply it only after all code and edge functions are deployed", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const sql = readFileSync(resolve(import.meta.dirname, "../migrations", CONTRACT), "utf8");
    expect(sql.slice(0, 800)).toMatch(/APPLY ONLY AFTER ALL CODE AND EDGE FUNCTIONS ARE DEPLOYED/);
    const expand = readFileSync(resolve(import.meta.dirname, "../migrations", EXPAND), "utf8");
    expect(expand).not.toMatch(/drop column/i);
    expect(expand.toLowerCase()).not.toMatch(/\n\s*revoke (select|all) on merchants/);
  });
});
