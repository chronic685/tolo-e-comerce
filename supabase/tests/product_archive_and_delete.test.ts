// Migrations 0091 (delete guard) and 0092 (archive/restore rules) run for real against
// in-process PGlite, through the same row-level-security shape products has -- see
// pglite/harness.ts. Never touches any Supabase project.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness, type TestUser } from "./pglite/harness.ts";

// The slice of the schema the two migrations use (0004, 0007, 0012, 0013, 0051), with the
// products RLS policy as 0051 left it.
const PRELUDE = /* sql */ `
create type product_status as enum ('draft','submitted','approved','published','paused','archived');
create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table merchant_staff (merchant_id uuid not null references merchants(id), user_id uuid not null references profiles(id));
create function is_merchant_member(p_merchant_id uuid) returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from merchants where id = p_merchant_id and owner_id = auth.uid())
   or exists (select 1 from merchant_staff where merchant_id = p_merchant_id and user_id = auth.uid()) $$;
create function has_admin_page(p_keys text[]) returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from profiles where id = auth.uid() and account_status = 'active'
   and (admin_tier is not null or (role like 'tolo\\_%' and permissions ?| p_keys))) $$;
create table products (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id),
  name text not null,
  status product_status not null default 'draft',
  updated_at timestamptz not null default now()
);
create function merchant_id_for_product(p_product_id uuid) returns uuid language sql stable security definer set search_path = public
as $$ select merchant_id from products where id = p_product_id $$;
create table product_variants (id uuid primary key default gen_random_uuid(), product_id uuid not null references products(id) on delete cascade);
create table order_items (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references product_variants(id) on delete restrict
);
alter table products enable row level security;
create policy products_manage on products for all
  using (is_merchant_member(merchant_id) or has_admin_page(array['products']))
  with check (is_merchant_member(merchant_id) or has_admin_page(array['products']));
`;

let h: Harness;
let merchantUser: TestUser;
let otherMerchantUser: TestUser;
let admin: TestUser;
let merchantId: string;

beforeAll(async () => {
  h = await createHarness(["0091_product_delete_guard.sql", "0092_product_archive_rules.sql"], { prelude: PRELUDE });
  merchantUser = await h.createAuthUser();
  otherMerchantUser = await h.createAuthUser();
  admin = await h.createAuthUser({ adminTier: "admin" });
  merchantId = randomUUID();
  await h.db.query("insert into merchants (id, owner_id, business_name) values ($1, $2, 'Mine')", [merchantId, merchantUser.id]);
  await h.db.query("insert into merchants (owner_id, business_name) values ($1, 'Theirs')", [otherMerchantUser.id]);
});

async function newProduct(status = "published"): Promise<string> {
  const id = randomUUID();
  await h.db.query("insert into products (id, merchant_id, name, status) values ($1, $2, 'Test product', $3)", [id, merchantId, status]);
  return id;
}

async function product(id: string) {
  const { rows } = await h.db.query<{
    status: string;
    archived_by: string | null;
    archived_by_role: string | null;
    archived_at: string | null;
    archived_from_status: string | null;
  }>("select status, archived_by, archived_by_role, archived_at, archived_from_status from products where id = $1", [id]);
  return rows[0];
}

async function audit(id: string) {
  const { rows } = await h.db.query<{ action: string; actor_id: string; metadata: Record<string, unknown> }>(
    "select action, actor_id, metadata from audit_logs where entity_id = $1 order by created_at, id",
    [id],
  );
  return rows;
}

function update(user: TestUser, id: string, sql: string, params: unknown[] = []) {
  return h.asUser(user.id, (tx) => tx.query(`update products set ${sql} where id = $1`, [id, ...params]));
}

async function order(id: string) {
  const variant = randomUUID();
  await h.db.query("insert into product_variants (id, product_id) values ($1, $2)", [variant, id]);
  await h.db.query("insert into order_items (variant_id) values ($1)", [variant]);
}

describe("0091 delete guard", () => {
  it("lets a merchant delete a product nobody has ordered, and logs it", async () => {
    const id = await newProduct();
    await h.asUser(merchantUser.id, (tx) => tx.query("delete from products where id = $1", [id]));
    expect((await h.db.query("select 1 from products where id = $1", [id])).rows).toHaveLength(0);
    const log = await audit(id);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: "delete", actor_id: merchantUser.id });
  });

  it("refuses to delete a product any order has referenced, with a readable message", async () => {
    const id = await newProduct();
    await order(id);
    await expect(h.asUser(merchantUser.id, (tx) => tx.query("delete from products where id = $1", [id]))).rejects.toThrow(/has been ordered.*Archive it instead/);
    expect((await h.db.query("select 1 from products where id = $1", [id])).rows).toHaveLength(1);
  });

  it("product_has_orders answers for the owner and refuses a stranger", async () => {
    const ordered = await newProduct();
    await order(ordered);
    const fresh = await newProduct();
    const ask = (user: TestUser, id: string) => h.asUser(user.id, (tx) => tx.query<{ r: boolean }>("select product_has_orders($1) as r", [id]));
    expect((await ask(merchantUser, ordered)).rows[0].r).toBe(true);
    expect((await ask(merchantUser, fresh)).rows[0].r).toBe(false);
    expect((await ask(admin, ordered)).rows[0].r).toBe(true);
    await expect(ask(otherMerchantUser, ordered)).rejects.toThrow(/Not authorized/);
  });

  it("does not let a merchant delete another merchant's product at all (row-level security)", async () => {
    const id = await newProduct();
    await h.asUser(otherMerchantUser.id, (tx) => tx.query("delete from products where id = $1", [id]));
    expect((await h.db.query("select 1 from products where id = $1", [id])).rows).toHaveLength(1);
  });
});

describe("0092 archive by a merchant", () => {
  it("records who, as what role, when, and from which status, and writes an audit row", async () => {
    const id = await newProduct("published");
    await update(merchantUser, id, "status = 'archived'");
    const p = await product(id);
    expect(p).toMatchObject({ status: "archived", archived_by: merchantUser.id, archived_by_role: "merchant", archived_from_status: "published" });
    expect(p.archived_at).not.toBeNull();
    const log = await audit(id);
    expect(log[0]).toMatchObject({ action: "archive", actor_id: merchantUser.id });
    expect(log[0].metadata).toMatchObject({ role: "merchant", from_status: "published" });
  });

  it("lets the merchant restore it, clears the record, and logs the restore", async () => {
    const id = await newProduct("published");
    await update(merchantUser, id, "status = 'archived'");
    await update(merchantUser, id, "status = 'paused'");
    expect(await product(id)).toMatchObject({ status: "paused", archived_by: null, archived_by_role: null, archived_at: null, archived_from_status: null });
    expect((await audit(id)).map((r) => r.action)).toEqual(["archive", "restore"]);
  });

  it("lets admin staff restore a merchant-archived product", async () => {
    const id = await newProduct("published");
    await update(merchantUser, id, "status = 'archived'");
    await update(admin, id, "status = 'paused'");
    expect((await product(id)).status).toBe("paused");
    expect((await audit(id))[1].metadata).toMatchObject({ role: "staff", archived_by_role: "merchant" });
  });

  it("does not let a stranger archive someone else's product", async () => {
    const id = await newProduct("published");
    await update(otherMerchantUser, id, "status = 'archived'"); // RLS filters the row out
    expect((await product(id)).status).toBe("published");
  });
});

describe("0092 archive by admin staff", () => {
  it("records the archive as staff", async () => {
    const id = await newProduct("published");
    await update(admin, id, "status = 'archived'");
    expect(await product(id)).toMatchObject({ status: "archived", archived_by: admin.id, archived_by_role: "staff" });
  });

  it("cannot be restored by the merchant, however they try", async () => {
    const id = await newProduct("published");
    await update(admin, id, "status = 'archived'");
    await expect(update(merchantUser, id, "status = 'paused'")).rejects.toThrow(/only Tolo staff can restore/);
    await expect(update(merchantUser, id, "status = 'published'")).rejects.toThrow(/only Tolo staff can restore/);
    expect((await product(id)).status).toBe("archived");
  });

  it("freezes the product for the merchant while archived (no edits, no delete)", async () => {
    const id = await newProduct("published");
    await update(admin, id, "status = 'archived'");
    await expect(update(merchantUser, id, "name = 'Renamed'")).rejects.toThrow(/only Tolo staff can change/);
    await expect(h.asUser(merchantUser.id, (tx) => tx.query("delete from products where id = $1", [id]))).rejects.toThrow(/only Tolo staff can delete/);
  });

  it("can be restored by admin staff", async () => {
    const id = await newProduct("published");
    await update(admin, id, "status = 'archived'");
    await update(admin, id, "status = 'paused'");
    expect((await product(id)).status).toBe("paused");
  });

  it("an admin archiving a merchant's product counts as staff even though the merchant could also have", async () => {
    const id = await newProduct("paused");
    await update(admin, id, "status = 'archived'");
    expect((await product(id)).archived_by_role).toBe("staff");
  });
});

describe("0092 the archive record cannot be forged", () => {
  it("ignores archived_* values a client writes", async () => {
    const id = await newProduct("published");
    await update(merchantUser, id, "archived_by_role = 'staff', archived_by = $2, archived_at = now()", [admin.id]);
    expect(await product(id)).toMatchObject({ status: "published", archived_by: null, archived_by_role: null, archived_at: null });
  });

  it("a merchant cannot flip a merchant-archived product to look staff-archived or vice versa", async () => {
    const id = await newProduct("published");
    await update(merchantUser, id, "status = 'archived'");
    await update(merchantUser, id, "archived_by_role = 'staff'");
    expect((await product(id)).archived_by_role).toBe("merchant");
  });
});

describe("0092 bulk helpers", () => {
  it("archive_products archives what the caller may touch and nothing else", async () => {
    const mine = await newProduct("published");
    const theirs = randomUUID();
    const theirMerchant = (await h.db.query<{ id: string }>("select id from merchants where owner_id = $1", [otherMerchantUser.id])).rows[0].id;
    await h.db.query("insert into products (id, merchant_id, name, status) values ($1, $2, 'Other', 'published')", [theirs, theirMerchant]);
    const { rows } = await h.asUser(merchantUser.id, (tx) => tx.query<{ n: number }>("select archive_products($1) as n", [[mine, theirs]]));
    expect(rows[0].n).toBe(1);
    expect((await product(mine)).status).toBe("archived");
    expect((await product(theirs)).status).toBe("published");
  });

  it("restore_products brings products back hidden (or as drafts), and counts the ones it may not restore as blocked", async () => {
    const byMerchant = await newProduct("published");
    const byStaff = await newProduct("published");
    const neverLive = await newProduct("draft");
    await update(merchantUser, byMerchant, "status = 'archived'");
    await update(admin, byStaff, "status = 'archived'");
    await update(merchantUser, neverLive, "status = 'archived'");

    const asMerchant = await h.asUser(merchantUser.id, (tx) =>
      tx.query<{ restored: number; blocked: number }>("select * from restore_products($1)", [[byMerchant, byStaff, neverLive]]),
    );
    expect(asMerchant.rows[0]).toEqual({ restored: 2, blocked: 1 });
    expect((await product(byMerchant)).status).toBe("paused");
    expect((await product(neverLive)).status).toBe("draft");
    expect((await product(byStaff)).status).toBe("archived");

    const asAdmin = await h.asUser(admin.id, (tx) => tx.query<{ restored: number; blocked: number }>("select * from restore_products($1)", [[byStaff]]));
    expect(asAdmin.rows[0]).toEqual({ restored: 1, blocked: 0 });
    expect((await product(byStaff)).status).toBe("paused");
  });
});
