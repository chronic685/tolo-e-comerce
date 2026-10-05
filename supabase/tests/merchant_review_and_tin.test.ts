// Migrations 0093 (merchant source, review guard, permission mapping) and 0094 (TIN) against
// in-process PGlite -- see pglite/harness.ts. Never touches any Supabase project.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness, type TestUser } from "./pglite/harness.ts";

const LEGACY_STAFF = randomUUID();

// Things the harness does not model: merchant columns added after 0002, the audit log, the page
// checklist helper, and a staff profile holding the old "merchant_applications" permission.
const PRELUDE = /* sql */ `
alter table merchants
  add column rejection_reason text,
  add column suspension_reason text;
create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create function has_admin_page(p_keys text[]) returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from profiles where id = auth.uid() and account_status = 'active'
   and (admin_tier is not null or (role like 'tolo\\_%' and permissions ?| p_keys))) $$;
-- merchants RLS as 0014/0051 left it: owners and Merchants-page staff can update.
create policy merchants_select on merchants for select using (true);
create policy merchants_update on merchants for update using (owner_id = auth.uid() or has_admin_page(array['merchants']));
insert into auth.users (id, email) values ('${LEGACY_STAFF}', 'legacy@test.local');
insert into profiles (id, role, permissions) values ('${LEGACY_STAFF}', 'tolo_ops', '["merchant_applications", "orders"]');
`;

let h: Harness;
let category: string;
let admin: TestUser;
let staff: TestUser;

beforeAll(async () => {
  h = await createHarness(
    [
      "0072_tolo_phone_links.sql",
      "0073_merchant_applications.sql",
      "0074_merchant_application_licenses_storage.sql",
      "0075_merchant_application_approval.sql",
      "0090_merchant_category_id.sql",
      "0093_merchant_source_and_review_guard.sql",
      "0094_merchant_tin.sql",
    ],
    { prelude: PRELUDE },
  );
  category = await h.createCategory();
  admin = await h.createUser({ adminTier: "admin" });
  staff = await h.createUser({ role: "tolo_ops" });
  await h.db.query(`update profiles set permissions = '["merchants"]' where id = $1`, [staff.id]);
});

let tinCounter = 1000000000;
const nextTin = () => String(tinCounter++);

function submit(user: TestUser, tin: string | null, license: string | null = null, name = "Abebe's Coffee") {
  return h.asUser(user.id, (tx) =>
    tx.query<{ id: string; tin: string | null; license_photo_url: string | null }>(
      "select * from submit_merchant_application($1, $2, 'Bole, Addis Ababa', $3, $4)",
      [name, category, tin, license],
    ),
  );
}

function approve(applicationId: string, ownerId: string) {
  return h.asService((tx) =>
    tx.query<{ merchant_id: string }>("select approve_merchant_application($1, $2, $3, null) as merchant_id", [applicationId, ownerId, admin.id]),
  );
}

async function newMerchant(status = "registered", ownerUser?: TestUser): Promise<{ id: string; owner: TestUser }> {
  const owner = ownerUser ?? (await h.createUser());
  const id = randomUUID();
  await h.db.query("insert into merchants (id, owner_id, business_name, status) values ($1, $2, 'Shop', $3)", [id, owner.id, status]);
  return { id, owner };
}

async function merchantStatus(id: string): Promise<string> {
  return (await h.db.query<{ status: string }>("select status from merchants where id = $1", [id])).rows[0].status;
}

describe("0093 source", () => {
  it("marks a merchant created by approving a Tolo-app application as tolo_app, and the default as dashboard", async () => {
    const user = await h.createUser();
    const app = (await submit(user, nextTin())).rows[0];
    const merchantId = (await approve(app.id, user.id)).rows[0].merchant_id;
    expect((await h.db.query<{ source: string }>("select source from merchants where id = $1", [merchantId])).rows[0].source).toBe("tolo_app");
    const { id } = await newMerchant();
    expect((await h.db.query<{ source: string }>("select source from merchants where id = $1", [id])).rows[0].source).toBe("dashboard");
  });
});

describe("0093 approve/reject is admin-tier only, in the database", () => {
  const setStatus = (user: TestUser, id: string, status: string) =>
    h.asUser(user.id, (tx) => tx.query("update merchants set status = $2 where id = $1", [id, status]));

  it("lets an admin approve and reject a registered merchant", async () => {
    const a = await newMerchant("registered");
    await setStatus(admin, a.id, "active");
    expect(await merchantStatus(a.id)).toBe("active");
    const b = await newMerchant("under_review");
    await setStatus(admin, b.id, "rejected");
    expect(await merchantStatus(b.id)).toBe("rejected");
  });

  it("refuses staff with the Merchants page, for approval and for rejection", async () => {
    for (const from of ["registered", "pending_verification", "under_review"]) {
      const m = await newMerchant(from);
      await expect(setStatus(staff, m.id, "active")).rejects.toThrow(/Only an admin or super admin/);
      await expect(setStatus(staff, m.id, "rejected")).rejects.toThrow(/Only an admin or super admin/);
      expect(await merchantStatus(m.id)).toBe(from);
    }
  });

  it("still lets staff suspend and reinstate an active merchant", async () => {
    const m = await newMerchant("active");
    await setStatus(staff, m.id, "suspended");
    await setStatus(staff, m.id, "active");
    expect(await merchantStatus(m.id)).toBe("active");
  });

  it("does not let staff stamp an approval", async () => {
    const m = await newMerchant("active");
    await expect(h.asUser(staff.id, (tx) => tx.query("update merchants set approved_by = $2, approved_at = now() where id = $1", [m.id, staff.id]))).rejects.toThrow(
      /Only an admin or super admin/,
    );
  });

  it("does not let a merchant approve itself, or touch its source or reasons", async () => {
    const m = await newMerchant("registered");
    await expect(setStatus(m.owner, m.id, "active")).rejects.toThrow(/Only an admin or super admin/);
    const active = await newMerchant("active");
    await expect(setStatus(active.owner, active.id, "suspended")).rejects.toThrow(/Only Tolo staff/);
    await expect(h.asUser(active.owner.id, (tx) => tx.query("update merchants set source = 'tolo_app' where id = $1", [active.id]))).rejects.toThrow(/set by Tolo staff/);
    await expect(h.asUser(active.owner.id, (tx) => tx.query("update merchants set rejection_reason = 'x' where id = $1", [active.id]))).rejects.toThrow(/set by Tolo staff/);
    // ...but an ordinary profile edit is fine.
    await h.asUser(active.owner.id, (tx) => tx.query("update merchants set business_name = 'Renamed' where id = $1", [active.id]));
  });

  it("trusts the service role (Edge Functions, scripts)", async () => {
    const m = await newMerchant("registered");
    await h.db.query("update merchants set status = 'active' where id = $1", [m.id]);
    expect(await merchantStatus(m.id)).toBe("active");
  });
});

describe("0093 permission mapping", () => {
  it("drops the old merchant_applications key and grants merchants in its place, keeping the rest", async () => {
    const { rows } = await h.db.query<{ permissions: string[] }>("select permissions from profiles where id = $1", [LEGACY_STAFF]);
    expect(rows[0].permissions.sort()).toEqual(["merchants", "orders"]);
  });
});

describe("0094 submitting with a TIN", () => {
  it("requires a 10-digit TIN", async () => {
    const user = await h.createUser();
    for (const bad of [null, "", "123456789", "12345678901", "12345abcde", "123 456 7890"]) {
      await expect(submit(user, bad)).rejects.toThrow(/invalid_tin/);
    }
  });

  it("accepts a TIN with no license photo, and stores it", async () => {
    const user = await h.createUser();
    const row = (await submit(user, nextTin())).rows[0];
    expect(row.tin).toMatch(/^[0-9]{10}$/);
    expect(row.license_photo_url).toBeNull();
  });

  it("still accepts an optional license photo from the applicant's own folder", async () => {
    const user = await h.createUser();
    const license = await h.uploadLicense(user.id);
    expect((await submit(user, nextTin(), license)).rows[0].license_photo_url).toBe(license);
    const other = await h.createUser();
    await expect(submit(other, nextTin(), `${user.id}/someone-elses.jpg`)).rejects.toThrow(/invalid_license_photo/);
  });

  it("refuses a TIN another pending application already has, and frees it once that is rejected", async () => {
    const tin = nextTin();
    const first = await h.createUser();
    const second = await h.createUser();
    const app = (await submit(first, tin)).rows[0];
    await expect(submit(second, tin)).rejects.toThrow(/tin_already_registered/);
    await h.asUser(admin.id, (tx) => tx.query("update merchant_applications set status = 'rejected' where id = $1", [app.id]));
    await expect(submit(second, tin)).resolves.toBeDefined();
  });

  it("refuses a TIN an approved merchant has", async () => {
    const tin = nextTin();
    const first = await h.createUser();
    const app = (await submit(first, tin)).rows[0];
    await approve(app.id, first.id);
    const second = await h.createUser();
    await expect(submit(second, tin)).rejects.toThrow(/tin_already_registered/);
  });

  it("refuses a TIN a dashboard-signup merchant has", async () => {
    const tin = nextTin();
    const m = await newMerchant("active");
    await h.db.query("select set_merchant_tin($1, $2)", [m.id, tin]);
    const applicant = await h.createUser();
    await expect(submit(applicant, tin)).rejects.toThrow(/tin_already_registered/);
  });

  it("cannot have its TIN edited after submission", async () => {
    const user = await h.createUser();
    const app = (await submit(user, nextTin())).rows[0];
    await expect(h.asUser(admin.id, (tx) => tx.query("update merchant_applications set tin = '1111111111' where id = $1", [app.id]))).rejects.toThrow(/can't be changed/);
  });
});

describe("0094 approval carries the TIN to the merchant", () => {
  it("copies it into merchant_tins even though the application was holding it", async () => {
    const tin = nextTin();
    const user = await h.createUser();
    const app = (await submit(user, tin)).rows[0];
    const merchantId = (await approve(app.id, user.id)).rows[0].merchant_id;
    const { rows } = await h.db.query<{ tin: string }>("select tin from merchant_tins where merchant_id = $1", [merchantId]);
    expect(rows).toEqual([{ tin }]);
  });
});

describe("0094 who can see and change a merchant's TIN", () => {
  it("lets admin tier and the merchant's own owner read it, and nobody else", async () => {
    const tin = nextTin();
    const m = await newMerchant("active");
    await h.db.query("select set_merchant_tin($1, $2)", [m.id, tin]);
    const read = (user: TestUser | null) =>
      (user
        ? h.asUser(user.id, (tx) => tx.query<{ tin: string }>("select tin from merchant_tins where merchant_id = $1", [m.id]))
        : h.asAnon((tx) => tx.query<{ tin: string }>("select tin from merchant_tins where merchant_id = $1", [m.id]))
      ).then((r) => r.rows);
    expect(await read(admin)).toEqual([{ tin }]);
    expect(await read(m.owner)).toEqual([{ tin }]);
    expect(await read(staff)).toEqual([]);
    expect(await read(await h.createUser())).toEqual([]);
    await expect(read(null)).rejects.toThrow(/permission denied/);
  });

  it("is not writable directly by any client role", async () => {
    const m = await newMerchant("active");
    await expect(h.asUser(admin.id, (tx) => tx.query("insert into merchant_tins (merchant_id, tin) values ($1, $2)", [m.id, nextTin()]))).rejects.toThrow(/permission denied/);
    await expect(h.asUser(m.owner.id, (tx) => tx.query("update merchant_tins set tin = $1", [nextTin()]))).rejects.toThrow(/permission denied/);
  });

  it("lets a merchant set its own TIN once, then only an admin can change it", async () => {
    const m = await newMerchant("registered");
    const set = (user: TestUser, tin: string | null) => h.asUser(user.id, (tx) => tx.query("select set_merchant_tin($1, $2)", [m.id, tin]));
    await set(m.owner, nextTin());
    await expect(set(m.owner, nextTin())).rejects.toThrow(/Only an admin or super admin/);
    const changed = nextTin();
    await set(admin, changed);
    expect((await h.db.query<{ tin: string }>("select tin from merchant_tins where merchant_id = $1", [m.id])).rows[0].tin).toBe(changed);
  });

  it("refuses staff, bad formats, and a TIN another merchant has; lets an admin clear it", async () => {
    const m = await newMerchant("active");
    await expect(h.asUser(staff.id, (tx) => tx.query("select set_merchant_tin($1, $2)", [m.id, nextTin()]))).rejects.toThrow(/Only an admin or super admin/);
    await expect(h.asUser(admin.id, (tx) => tx.query("select set_merchant_tin($1, '12345')", [m.id]))).rejects.toThrow(/invalid_tin/);
    const taken = nextTin();
    const other = await newMerchant("active");
    await h.db.query("select set_merchant_tin($1, $2)", [other.id, taken]);
    await expect(h.asUser(admin.id, (tx) => tx.query("select set_merchant_tin($1, $2)", [m.id, taken]))).rejects.toThrow(/tin_already_registered/);
    await h.asUser(admin.id, (tx) => tx.query("select set_merchant_tin($1, $2)", [other.id, null]));
    expect((await h.db.query("select 1 from merchant_tins where merchant_id = $1", [other.id])).rows).toHaveLength(0);
  });

  it("audits an admin's change with only the last four digits", async () => {
    const m = await newMerchant("active");
    await h.db.query("select set_merchant_tin($1, '1234567890')", [m.id]);
    await h.asUser(admin.id, (tx) => tx.query("select set_merchant_tin($1, '1234500000')", [m.id]));
    const { rows } = await h.db.query<{ actor_id: string; metadata: Record<string, string> }>("select actor_id, metadata from audit_logs where entity_id = $1", [m.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_id).toBe(admin.id);
    expect(rows[0].metadata).toEqual({ before_last4: "7890", after_last4: "0000" });
    expect(JSON.stringify(rows[0].metadata)).not.toContain("1234567890");
  });
});
