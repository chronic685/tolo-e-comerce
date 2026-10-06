// Migrations 0099 (expand: merchant_private, admin customer controls, admin merchant controls) and 0100 (contract: drop the public contact
// columns) against in-process PGlite -- see pglite/harness.ts. Never touches any Supabase project;
// every row it creates lives and dies in that in-memory database.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { ADMIN_PRELUDE as PRELUDE } from "./pglite/adminPrelude.ts";
import { createHarness, type Harness, type TestUser } from "./pglite/harness.ts";


let h: Harness;
let admin: TestUser;
let customerStaff: TestUser; // staff with the Customers page
let merchantStaff: TestUser; // staff with the Merchants page
let otherStaff: TestUser; // staff with neither

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
      "0099_expand_merchant_private_and_admin_controls.sql",
      "0100_contract_drop_public_merchant_contacts.sql",
    ],
    { prelude: PRELUDE },
  );
  admin = await h.createUser({ adminTier: "admin" });
  customerStaff = await h.createUser({ role: "tolo_ops" });
  merchantStaff = await h.createUser({ role: "tolo_ops" });
  otherStaff = await h.createUser({ role: "tolo_ops" });
  await h.db.query(`update profiles set permissions = '["customers"]' where id = $1`, [customerStaff.id]);
  await h.db.query(`update profiles set permissions = '["merchants"]' where id = $1`, [merchantStaff.id]);
  await h.db.query(`update profiles set permissions = '["orders"]' where id = $1`, [otherStaff.id]);
});

const call = <T = Record<string, unknown>>(user: TestUser, sql: string, params: unknown[] = []) =>
  h.asUser(user.id, (tx) => tx.query<T>(sql, params)).then((r) => r.rows);

async function audit(entityId: string) {
  return (await h.db.query<{ action: string; actor_id: string; metadata: Record<string, any> }>("select action, actor_id, metadata from audit_logs where entity_id = $1 order by created_at, id", [entityId])).rows;
}

// ------------------------------------------------------------------------------------- customers
async function newCustomer(opts: { phone?: string; withAddress?: boolean } = {}) {
  const user = await h.createUser({ phone: opts.phone });
  await h.db.query("update profiles set full_name = 'Abebe Kebede', phone = $2 where id = $1", [user.id, "+251911000111"]);
  await h.db.query("update auth.users set email = $2 where id = $1", [user.id, `${user.id}@mail.test`]);
  let addressId: string | null = null;
  if (opts.withAddress !== false) {
    addressId = randomUUID();
    await h.db.query("insert into addresses (id, customer_id, label, recipient_name, phone, line1, city) values ($1, $2, 'Home', 'Abebe', '+251911000111', 'Bole Road 1', 'Addis Ababa')", [addressId, user.id]);
  }
  return { user, addressId };
}

async function newOrder(customerId: string, addressId: string, status: string, payment = "paid") {
  const merchant = await newMerchant("active");
  const orderId = randomUUID();
  await h.db.query("insert into orders (id, customer_id, address_id, order_number, total, payment_status) values ($1, $2, $3, 1001, 500, $4)", [orderId, customerId, addressId, payment]);
  const moId = randomUUID();
  await h.db.query("insert into merchant_orders (id, order_id, merchant_id, status) values ($1, $2, $3, $4)", [moId, orderId, merchant.id, status]);
  return { orderId, moId, merchant };
}

describe("customer detail", () => {
  it("is open to staff with the Customers page and to admin, and to nobody else", async () => {
    const { user } = await newCustomer();
    const asStaff = (await call<{ d: any }>(customerStaff, "select admin_customer_detail($1) as d", [user.id]))[0].d;
    expect(asStaff.profile.full_name).toBe("Abebe Kebede");
    expect(asStaff.email).toBe(`${user.id}@mail.test`);
    expect(asStaff.addresses).toHaveLength(1);
    expect((await call<{ d: any }>(admin, "select admin_customer_detail($1) as d", [user.id]))[0].d.profile.id).toBe(user.id);
    await expect(call(otherStaff, "select admin_customer_detail($1)", [user.id])).rejects.toThrow(/Not authorized/);
    await expect(call(user, "select admin_customer_detail($1)", [user.id])).rejects.toThrow(/Not authorized/);
    await expect(h.asAnon((tx) => tx.query("select admin_customer_detail($1)", [user.id]))).rejects.toThrow(/permission denied/);
  });

  it("includes orders with totals and statuses, and shows the Tolo phone in full to admin tier only", async () => {
    const { user, addressId } = await newCustomer({ phone: "+251922333444" });
    await newOrder(user.id, addressId!, "completed");
    const staffView = (await call<{ d: any }>(customerStaff, "select admin_customer_detail($1) as d", [user.id]))[0].d;
    expect(staffView.order_count).toBe(1);
    expect(Number(staffView.paid_total)).toBe(500);
    expect(staffView.orders[0].statuses).toEqual(["completed"]);
    expect(staffView.tolo_linked).toBe(true);
    expect(staffView.tolo_phone).toBe("••••3444");
    expect((await call<{ d: any }>(admin, "select admin_customer_detail($1) as d", [user.id]))[0].d.tolo_phone).toBe("+251922333444");
  });

  it("does not open a staff or admin account as a customer", async () => {
    await expect(call(admin, "select admin_customer_detail($1)", [customerStaff.id])).rejects.toThrow(/customer_not_found/);
  });
});

describe("customer edit", () => {
  it("lets staff change name and email, and audits before and after", async () => {
    const { user } = await newCustomer();
    await call(customerStaff, `select admin_update_customer($1, '{"full_name":"Abebe K.","email":"New@Mail.test"}')`, [user.id]);
    expect((await h.db.query<{ full_name: string }>("select full_name from profiles where id = $1", [user.id])).rows[0].full_name).toBe("Abebe K.");
    expect((await h.db.query<{ email: string }>("select email from auth.users where id = $1", [user.id])).rows[0].email).toBe("new@mail.test");
    const [row] = await audit(user.id);
    expect(row.actor_id).toBe(customerStaff.id);
    expect(row.metadata.before.full_name).toBe("Abebe Kebede");
    expect(row.metadata.after).toMatchObject({ full_name: "Abebe K.", email: "new@mail.test" });
  });

  it("refuses an email another account already uses, a bad email, and a field it does not know", async () => {
    const a = await newCustomer();
    const b = await newCustomer();
    const taken = (await h.db.query<{ email: string }>("select email from auth.users where id = $1", [b.user.id])).rows[0].email;
    await expect(call(admin, "select admin_update_customer($1, jsonb_build_object('email', $2::text))", [a.user.id, taken])).rejects.toThrow(/email_already_used/);
    await expect(call(admin, `select admin_update_customer($1, '{"email":"nope"}')`, [a.user.id])).rejects.toThrow(/invalid_email/);
    await expect(call(admin, `select admin_update_customer($1, '{"role":"tolo_ops"}')`, [a.user.id])).rejects.toThrow(/unsupported_field/);
  });

  it("changes a phone only for admin tier, masks it in the audit trail, and never touches the Tolo link", async () => {
    const { user } = await newCustomer({ phone: "+251933444555" });
    await expect(call(customerStaff, `select admin_update_customer($1, '{"phone":"+251900000999"}')`, [user.id])).rejects.toThrow(/Only an admin or super admin/);
    await call(admin, `select admin_update_customer($1, '{"phone":"+251900000999"}')`, [user.id]);
    expect((await h.db.query<{ phone: string }>("select phone from profiles where id = $1", [user.id])).rows[0].phone).toBe("+251900000999");
    // The verified link is exactly as it was, and the profile phone is still not marked verified.
    expect((await h.db.query<{ phone: string }>("select phone from tolo_phone_links where user_id = $1", [user.id])).rows[0].phone).toBe("+251933444555");
    expect((await h.db.query<{ phone_verified: boolean }>("select phone_verified from profiles where id = $1", [user.id])).rows[0].phone_verified).toBe(false);
    const [row] = await audit(user.id);
    expect(row.metadata.after.phone).toBe("••••0999");
    expect(JSON.stringify(row.metadata)).not.toContain("251900000999");
  });

  it("refuses a phone that another account has verified with Tolo (no impersonation)", async () => {
    const victim = await newCustomer({ phone: "+251944555666" });
    const target = await newCustomer();
    await expect(call(admin, `select admin_update_customer($1, '{"phone":"+251944555666"}')`, [target.user.id])).rejects.toThrow(/phone_linked_to_another_account/);
    expect((await h.db.query<{ user_id: string }>("select user_id from tolo_phone_links where phone = '+251944555666'")).rows[0].user_id).toBe(victim.user.id);
  });

  it("edits an address, with the delivery phone admin-only", async () => {
    const { user, addressId } = await newCustomer();
    await call(customerStaff, `select admin_update_customer_address($1, '{"line1":"Bole Road 2","landmark":"Next to the bank"}')`, [addressId]);
    expect((await h.db.query<{ line1: string }>("select line1 from addresses where id = $1", [addressId])).rows[0].line1).toBe("Bole Road 2");
    await expect(call(customerStaff, `select admin_update_customer_address($1, '{"phone":"+251900111222"}')`, [addressId])).rejects.toThrow(/Only an admin or super admin/);
    await call(admin, `select admin_update_customer_address($1, '{"phone":"+251900111222"}')`, [addressId]);
    expect((await audit(addressId!)).at(-1)!.metadata.after.phone).toBe("••••1222");
    await expect(call(otherStaff, `select admin_update_customer_address($1, '{"line1":"x"}')`, [addressId])).rejects.toThrow(/Not authorized/);
    expect(user.id).toBeTruthy();
  });
});

describe("customer anonymize", () => {
  it("is admin tier only", async () => {
    const { user } = await newCustomer();
    await expect(call(customerStaff, "select admin_anonymize_customer($1)", [user.id])).rejects.toThrow(/Only an admin or super admin/);
    await expect(call(user, "select admin_anonymize_customer($1)", [user.id])).rejects.toThrow(/Only an admin or super admin/);
  });

  it("is refused while an order is in progress, and while a refund is pending", async () => {
    const a = await newCustomer();
    await newOrder(a.user.id, a.addressId!, "processing");
    await expect(call(admin, "select admin_anonymize_customer($1)", [a.user.id])).rejects.toThrow(/customer_has_active_orders/);

    const b = await newCustomer();
    const { moId } = await newOrder(b.user.id, b.addressId!, "completed");
    const returnId = randomUUID();
    await h.db.query("insert into returns (id, merchant_order_id, customer_id) values ($1, $2, $3)", [returnId, moId, b.user.id]);
    await h.db.query("insert into refunds (return_id, amount, status) values ($1, 100, 'pending')", [returnId]);
    await expect(call(admin, "select admin_anonymize_customer($1)", [b.user.id])).rejects.toThrow(/customer_has_pending_refunds/);
  });

  it("is refused for a staff account and for a merchant owner", async () => {
    await expect(call(admin, "select admin_anonymize_customer($1)", [customerStaff.id])).rejects.toThrow(/customer_not_found/);
    const owner = await newCustomer();
    await newMerchant("active", owner.user);
    await expect(call(admin, "select admin_anonymize_customer($1)", [owner.user.id])).rejects.toThrow(/customer_is_merchant_account/);
  });

  it("removes the person but keeps the order history, and says what it did", async () => {
    const { user, addressId } = await newCustomer({ phone: "+251955666777" });
    const extra = randomUUID();
    await h.db.query("insert into addresses (id, customer_id, recipient_name, line1, city) values ($1, $2, 'Spare', 'Spare street', 'Adama')", [extra, user.id]);
    const { orderId } = await newOrder(user.id, addressId!, "completed");
    const cartId = randomUUID();
    await h.db.query("insert into carts (id, customer_id) values ($1, $2)", [cartId, user.id]);
    await h.db.query("insert into cart_items (cart_id) values ($1)", [cartId]);
    await h.db.query("insert into customer_favorites (customer_id, product_id) values ($1, $2)", [user.id, randomUUID()]);
    await h.db.query("insert into notifications (user_id) values ($1)", [user.id]);

    const result = (await call<{ r: any }>(admin, "select admin_anonymize_customer($1) as r", [user.id]))[0].r;
    expect(result).toEqual({ addresses_overwritten: 1, addresses_deleted: 1 });

    const profile = (await h.db.query<Record<string, any>>("select * from profiles where id = $1", [user.id])).rows[0];
    expect(profile).toMatchObject({ full_name: "Deleted customer", phone: null, account_status: "suspended", phone_verified: false });
    expect(profile.anonymized_at).not.toBeNull();
    // The Tolo link is gone, so the phone is free and cannot sign anyone in to this account.
    expect((await h.db.query("select 1 from tolo_phone_links where user_id = $1", [user.id])).rows).toHaveLength(0);
    expect((await h.db.query("select 1 from tolo_phone_links where phone = '+251955666777'")).rows).toHaveLength(0);
    const auth = (await h.db.query<{ email: string; phone: string | null }>("select email, phone from auth.users where id = $1", [user.id])).rows[0];
    expect(auth.email).toBe(`deleted-${user.id}@deleted.invalid`);
    expect(auth.phone).toBeNull();
    // The order is still there, still pointing at an address row that no longer holds the person's details.
    expect((await h.db.query("select 1 from orders where id = $1", [orderId])).rows).toHaveLength(1);
    const kept = (await h.db.query<Record<string, any>>("select * from addresses where id = $1", [addressId])).rows[0];
    expect(kept).toMatchObject({ recipient_name: "Deleted customer", phone: null, line1: "Removed", label: null });
    expect((await h.db.query("select 1 from addresses where id = $1", [extra])).rows).toHaveLength(0);
    for (const table of ["carts", "customer_favorites"]) {
      expect((await h.db.query(`select 1 from ${table} where customer_id = $1`, [user.id])).rows).toHaveLength(0);
    }
    expect((await h.db.query("select 1 from notifications where user_id = $1", [user.id])).rows).toHaveLength(0);
    expect((await audit(user.id)).at(-1)).toMatchObject({ action: "anonymize", actor_id: admin.id });
  });

  it("cannot be repeated, edited, or switched back on by anyone but the system", async () => {
    const { user } = await newCustomer({ withAddress: false });
    await call(admin, "select admin_anonymize_customer($1)", [user.id]);
    await expect(call(admin, "select admin_anonymize_customer($1)", [user.id])).rejects.toThrow(/already_deleted/);
    await expect(call(admin, `select admin_update_customer($1, '{"full_name":"Back again"}')`, [user.id])).rejects.toThrow(/deleted/);
    await expect(h.asUser(admin.id, (tx) => tx.query("update profiles set account_status = 'active' where id = $1", [user.id]))).rejects.toThrow(/deleted/);
  });
});

// ------------------------------------------------------------------------------------- merchants
async function newMerchant(status = "active", ownerUser?: TestUser) {
  const owner = ownerUser ?? (await h.createUser());
  const id = randomUUID();
  await h.db.query("insert into merchants (id, owner_id, business_name, status) values ($1, $2, 'Habesha Shop', $3)", [id, owner.id, status]);
  await h.db.query("insert into merchant_private (merchant_id, phone, email, owner_full_name) values ($1, '+251911222333', 'shop@mail.test', 'Owner Name')", [id]);
  return { id, owner };
}

async function withStore(merchantId: string) {
  const storeId = randomUUID();
  await h.db.query("insert into stores (id, merchant_id, name, slug, logo_url, banner_url) values ($1, $2, 'Habesha Store', $3, 'https://x/logo.png', 'https://x/banner.png')", [storeId, merchantId, randomUUID()]);
  const p1 = randomUUID();
  const p2 = randomUUID();
  await h.db.query("insert into products (id, merchant_id, store_id, name, status) values ($1, $3, $4, 'Live product', 'published'), ($2, $3, $4, 'Draft product', 'draft')", [p1, p2, merchantId, storeId]);
  await h.db.query("insert into product_images (product_id, url) values ($1, 'https://x/p1.png')", [p1]);
  return { storeId, p1, p2 };
}

describe("merchant contact details are no longer public (0099 expand + 0100 contract)", () => {
  it("lets an anonymous visitor read the safe columns of an active merchant, and no contact column", async () => {
    const m = await newMerchant("active");
    const { rows } = await h.asAnon((tx) => tx.query<{ business_name: string }>("select business_name, status from merchants where id = $1", [m.id]));
    expect(rows).toEqual([{ business_name: "Habesha Shop", status: "active" }]);
    for (const column of ["phone", "email", "owner_full_name", "owner_phone", "owner_email", "business_registration_number"]) {
      await expect(h.asAnon((tx) => tx.query(`select ${column} from merchants where id = $1`, [m.id]))).rejects.toThrow(/does not exist/);
    }
    await expect(h.asAnon((tx) => tx.query("select * from merchants where id = $1", [m.id]))).resolves.toBeDefined();
    const wide = await h.asAnon((tx) => tx.query<Record<string, unknown>>("select * from merchants where id = $1", [m.id]));
    expect(Object.keys(wide.rows[0])).not.toEqual(expect.arrayContaining(["phone"]));
    expect(Object.keys(wide.rows[0]).filter((k) => /^(phone|email|owner_full_name|owner_phone|owner_email|business_registration_number)$/.test(k))).toEqual([]);
  });

  it("gives an anonymous visitor no access at all to merchant_private", async () => {
    const m = await newMerchant("active");
    await expect(h.asAnon((tx) => tx.query("select phone from merchant_private where merchant_id = $1", [m.id]))).rejects.toThrow(/permission denied/);
  });

  it("gives a signed-in customer nothing from merchant_private either", async () => {
    const m = await newMerchant("active");
    const customer = await h.createUser();
    expect(await call(customer, "select phone from merchant_private where merchant_id = $1", [m.id])).toEqual([]);
  });

  it("still gives the owner, and staff who reach merchants, their contact details", async () => {
    const m = await newMerchant("active");
    expect(await call(m.owner, "select phone from merchant_private where merchant_id = $1", [m.id])).toEqual([{ phone: "+251911222333" }]);
    expect(await call(merchantStaff, "select phone from merchant_private where merchant_id = $1", [m.id])).toEqual([{ phone: "+251911222333" }]);
    expect(await call(customerStaff, "select phone from merchant_private where merchant_id = $1", [m.id])).toEqual([]);
  });

  it("keeps the approval flow working: the applicant's phone lands in merchant_private", async () => {
    const category = await h.createCategory();
    const applicant = await h.createUser();
    const app = (await h.asUser(applicant.id, (tx) => tx.query<{ id: string }>("select id from submit_merchant_application('Cafe', $1, 'Bole, Addis Ababa', '4440001112')", [category]))).rows[0];
    const merchantId = (await h.asService((tx) => tx.query<{ m: string }>("select approve_merchant_application($1, $2, $3, null) as m", [app.id, applicant.id, admin.id]))).rows[0].m;
    expect((await h.db.query<{ phone: string }>("select phone from merchant_private where merchant_id = $1", [merchantId])).rows[0].phone).toBe(applicant.phone);
  });

  it("limits staff to non-sensitive contact fields and leaves the owner and admin free", async () => {
    const m = await newMerchant("active");
    await h.asUser(merchantStaff.id, (tx) => tx.query("update merchant_private set email = 'fix@mail.test' where merchant_id = $1", [m.id]));
    await expect(h.asUser(merchantStaff.id, (tx) => tx.query("update merchant_private set phone = '+251900000000' where merchant_id = $1", [m.id]))).rejects.toThrow(/Only an admin or super admin/);
    await h.asUser(m.owner.id, (tx) => tx.query("update merchant_private set phone = '+251900000001' where merchant_id = $1", [m.id]));
    await h.asUser(admin.id, (tx) => tx.query("update merchant_private set phone = '+251900000002' where merchant_id = $1", [m.id]));
  });
});

describe("merchant detail", () => {
  it("is open to staff with the Merchants page and not to others", async () => {
    const m = await newMerchant("active");
    await withStore(m.id);
    const d = (await call<{ d: any }>(merchantStaff, "select admin_merchant_detail($1) as d", [m.id]))[0].d;
    expect(d.merchant.business_name).toBe("Habesha Shop");
    expect(d.private.phone).toBe("+251911222333");
    expect(d.products).toEqual({ total: 2, published: 1 });
    expect(d.rating).toEqual({ avg: 4.5, count: 3 });
    expect(d.can_hard_delete).toBe(true);
    await expect(call(customerStaff, "select admin_merchant_detail($1)", [m.id])).rejects.toThrow(/Not authorized/);
    await expect(call(m.owner, "select admin_merchant_detail($1)", [m.id])).rejects.toThrow(/Not authorized/);
  });

  it("shows the TIN, payouts and applications to admin tier only", async () => {
    const m = await newMerchant("active");
    await h.db.query("select set_merchant_tin($1, '7770001112')", [m.id]);
    await h.db.query("insert into settlements (merchant_id, total_amount) values ($1, 900)", [m.id]);
    const staffView = (await call<{ d: any }>(merchantStaff, "select admin_merchant_detail($1) as d", [m.id]))[0].d;
    expect(staffView.tin).toBeNull();
    expect(staffView.payouts).toEqual([]);
    expect(staffView.can_hard_delete).toBe(false);
    const adminView = (await call<{ d: any }>(admin, "select admin_merchant_detail($1) as d", [m.id]))[0].d;
    expect(adminView.tin).toBe("7770001112");
    expect(adminView.payouts).toHaveLength(1);
  });
});

describe("merchant edit", () => {
  it("lets staff edit business, contact and store fields, and audits before and after", async () => {
    const m = await newMerchant("active");
    await withStore(m.id);
    await call(
      merchantStaff,
      `select admin_update_merchant($1, '{"merchant":{"business_name":"Habesha Shop Plc","city":"Adama"},"private":{"email":"new@shop.test"},"store":{"description":"Fine goods","operating_hours":{"mon":{"open":"08:00","close":"18:00"}}}}')`,
      [m.id],
    );
    expect((await h.db.query<{ business_name: string; city: string }>("select business_name, city from merchants where id = $1", [m.id])).rows[0]).toEqual({ business_name: "Habesha Shop Plc", city: "Adama" });
    expect((await h.db.query<{ description: string; operating_hours: any }>("select description, operating_hours from stores where merchant_id = $1", [m.id])).rows[0]).toMatchObject({
      description: "Fine goods",
      operating_hours: { mon: { open: "08:00", close: "18:00" } },
    });
    const [row] = await audit(m.id);
    expect(row.actor_id).toBe(merchantStaff.id);
    expect(row.metadata.merchant.before.business_name).toBe("Habesha Shop");
    expect(row.metadata.merchant.after.business_name).toBe("Habesha Shop Plc");
  });

  it("keeps phones and the registration number admin-only, and masks them in the audit trail", async () => {
    const m = await newMerchant("active");
    await expect(call(merchantStaff, `select admin_update_merchant($1, '{"private":{"phone":"+251900000000"}}')`, [m.id])).rejects.toThrow(/Only an admin or super admin/);
    await call(admin, `select admin_update_merchant($1, '{"private":{"phone":"+251900000123","business_registration_number":"REG-98765"}}')`, [m.id]);
    const [row] = await audit(m.id);
    expect(row.metadata.private.after).toEqual({ phone: "••••0123", business_registration_number: "••••8765" });
    expect(JSON.stringify(row.metadata)).not.toContain("+251900000123");
  });

  it("refuses unknown fields (status and the owner are not editable here) and staff without the permission", async () => {
    const m = await newMerchant("active");
    await expect(call(admin, `select admin_update_merchant($1, '{"merchant":{"status":"suspended"}}')`, [m.id])).rejects.toThrow(/unsupported_field/);
    await expect(call(admin, `select admin_update_merchant($1, '{"merchant":{"owner_id":"${randomUUID()}"}}')`, [m.id])).rejects.toThrow(/unsupported_field/);
    await expect(call(customerStaff, `select admin_update_merchant($1, '{"merchant":{"city":"X"}}')`, [m.id])).rejects.toThrow(/Not authorized/);
    await expect(call(admin, `select admin_update_merchant($1, '{"merchant":{"business_name":"  "}}')`, [m.id])).rejects.toThrow(/invalid_name/);
  });

  it("still lets admin tier alone approve or reject (the 0093 rule is intact)", async () => {
    const m = await newMerchant("registered");
    await expect(h.asUser(merchantStaff.id, (tx) => tx.query("update merchants set status = 'active' where id = $1", [m.id]))).rejects.toThrow(/Only an admin or super admin/);
    await h.asUser(admin.id, (tx) => tx.query("update merchants set status = 'active' where id = $1", [m.id]));
  });
});

describe("close and reopen", () => {
  it("lets only admin tier close", async () => {
    const m = await newMerchant("active");
    await expect(call(merchantStaff, "select admin_close_merchant($1, 'x')", [m.id])).rejects.toThrow(/Only an admin or super admin/);
    await expect(call(m.owner, "select admin_close_merchant($1, 'x')", [m.id])).rejects.toThrow(/Only an admin or super admin/);
  });

  it("is refused while orders are in progress", async () => {
    const customer = await newCustomer();
    const { merchant } = await newOrder(customer.user.id, customer.addressId!, "ready_for_pickup");
    await expect(call(admin, "select admin_close_merchant($1, 'x')", [merchant.id])).rejects.toThrow(/merchant_has_active_orders/);
  });

  it("hides the storefront and products, locks the owner and staff out, and keeps every record", async () => {
    const m = await newMerchant("active");
    await h.db.query("insert into merchant_staff (merchant_id, user_id) values ($1, $2)", [m.id, (await h.createUser()).id]);
    const { p1, p2 } = await withStore(m.id);
    const result = (await call<{ r: any }>(admin, "select admin_close_merchant($1, 'Fraud investigation') as r", [m.id]))[0].r;
    expect(result).toEqual({ paused_products: 1 });

    const row = (await h.db.query<Record<string, any>>("select status, close_reason, closed_by, status_before_close from merchants where id = $1", [m.id])).rows[0];
    expect(row).toMatchObject({ status: "closed", close_reason: "Fraud investigation", closed_by: admin.id, status_before_close: "active" });
    expect((await h.db.query<{ status: string }>("select status from stores where merchant_id = $1", [m.id])).rows[0].status).toBe("closed");
    expect((await h.db.query<{ status: string; closed_paused: boolean }>("select status, closed_paused from products where id = $1", [p1])).rows[0]).toEqual({ status: "paused", closed_paused: true });
    expect((await h.db.query<{ status: string }>("select status from products where id = $1", [p2])).rows[0].status).toBe("draft");
    // The owner has no merchant-side rights any more, though the merchant row itself is still readable by them.
    expect((await call<{ ok: boolean }>(m.owner, "select is_merchant_member($1) as ok", [m.id]))[0].ok).toBe(false);
    expect(await call(m.owner, "select status from merchants where id = $1", [m.id])).toEqual([{ status: "closed" }]);
    expect((await audit(m.id)).at(-1)).toMatchObject({ action: "close", actor_id: admin.id });
    await expect(call(admin, "select admin_close_merchant($1, 'again')", [m.id])).rejects.toThrow(/merchant_already_closed/);
  });

  it("can be reopened by staff or admin, putting back exactly what closing changed", async () => {
    const m = await newMerchant("active");
    const { p1 } = await withStore(m.id);
    await call(admin, "select admin_close_merchant($1, 'x')", [m.id]);
    await expect(call(otherStaff, "select admin_reopen_merchant($1)", [m.id])).rejects.toThrow(/Not authorized/);
    const result = (await call<{ r: any }>(merchantStaff, "select admin_reopen_merchant($1) as r", [m.id]))[0].r;
    expect(result).toEqual({ relisted_products: 1, left_paused: 0 });
    expect((await h.db.query<{ status: string; closed_at: string | null }>("select status, closed_at from merchants where id = $1", [m.id])).rows[0]).toEqual({ status: "active", closed_at: null });
    expect((await h.db.query<{ status: string }>("select status from stores where merchant_id = $1", [m.id])).rows[0].status).toBe("active");
    expect((await h.db.query<{ status: string; closed_paused: boolean }>("select status, closed_paused from products where id = $1", [p1])).rows[0]).toEqual({ status: "published", closed_paused: false });
    expect((await call<{ ok: boolean }>(m.owner, "select is_merchant_member($1) as ok", [m.id]))[0].ok).toBe(true);
    expect((await audit(m.id)).map((r) => r.action)).toEqual(["close", "reopen"]);
    await expect(call(admin, "select admin_reopen_merchant($1)", [m.id])).rejects.toThrow(/merchant_not_closed/);
  });

  it("does not re-list a product that was paused before the close", async () => {
    const m = await newMerchant("active");
    const { storeId } = await withStore(m.id);
    const manual = randomUUID();
    await h.db.query("insert into products (id, merchant_id, store_id, name, status) values ($1, $2, $3, 'Hidden by merchant', 'paused')", [manual, m.id, storeId]);
    await call(admin, "select admin_close_merchant($1, 'x')", [m.id]);
    await call(admin, "select admin_reopen_merchant($1)", [m.id]);
    expect((await h.db.query<{ status: string }>("select status from products where id = $1", [manual])).rows[0].status).toBe("paused");
  });
});

describe("hard delete", () => {
  it("is admin tier only, and staff never get it", async () => {
    const m = await newMerchant("registered");
    await expect(call(merchantStaff, "select admin_delete_merchant($1)", [m.id])).rejects.toThrow(/Only an admin or super admin/);
    await expect(call(m.owner, "select admin_delete_merchant($1)", [m.id])).rejects.toThrow(/Only an admin or super admin/);
  });

  it("is refused once the merchant has ever had an order, a payout, a wallet movement or an adjustment", async () => {
    const customer = await newCustomer();
    const { merchant } = await newOrder(customer.user.id, customer.addressId!, "completed");
    await expect(call(admin, "select admin_delete_merchant($1)", [merchant.id])).rejects.toThrow(/merchant_has_history/);

    const paid = await newMerchant("active");
    await h.db.query("insert into settlements (merchant_id, total_amount) values ($1, 10)", [paid.id]);
    await expect(call(admin, "select admin_delete_merchant($1)", [paid.id])).rejects.toThrow(/merchant_has_history/);

    const wallet = await newMerchant("active");
    await h.db.query("insert into wallet_transactions (merchant_id, amount) values ($1, 5)", [wallet.id]);
    await expect(call(admin, "select admin_delete_merchant($1)", [wallet.id])).rejects.toThrow(/merchant_has_history/);

    const adjusted = await newMerchant("active");
    await h.db.query("insert into financial_adjustments (merchant_id) values ($1)", [adjusted.id]);
    await expect(call(admin, "select admin_delete_merchant($1)", [adjusted.id])).rejects.toThrow(/merchant_has_history/);
    expect((await h.db.query("select 1 from merchants where id = $1", [merchant.id])).rows).toHaveLength(1);
  });

  it("cascades exactly as documented, keeps the application and the owner's account, and reports the files to remove", async () => {
    const category = await h.createCategory();
    const applicant = await h.createUser();
    const app = (await h.asUser(applicant.id, (tx) => tx.query<{ id: string }>("select id from submit_merchant_application('Cafe', $1, 'Bole, Addis Ababa', '5550002223')", [category]))).rows[0];
    const merchantId = (await h.asService((tx) => tx.query<{ m: string }>("select approve_merchant_application($1, $2, $3, null) as m", [app.id, applicant.id, admin.id]))).rows[0].m;
    const { storeId } = await withStore(merchantId);
    await h.db.query("insert into merchant_staff (merchant_id, user_id) values ($1, $2)", [merchantId, applicant.id]);
    await h.db.query("insert into merchant_documents (merchant_id, file_url) values ($1, $2)", [merchantId, `${merchantId}/trade_license.pdf`]);

    const files = (await call<{ f: any }>(admin, "select admin_delete_merchant($1) as f", [merchantId]))[0].f;
    expect(files).toEqual({
      product_images: ["https://x/p1.png"],
      store_images: ["https://x/logo.png", "https://x/banner.png"],
      documents: [`${merchantId}/trade_license.pdf`],
    });
    for (const [table, column] of [["merchants", "id"], ["stores", "id"], ["products", "merchant_id"], ["merchant_staff", "merchant_id"], ["merchant_documents", "merchant_id"], ["merchant_private", "merchant_id"], ["merchant_tins", "merchant_id"]] as const) {
      const key = table === "stores" ? storeId : merchantId;
      expect((await h.db.query(`select 1 from ${table} where ${column} = $1`, [key])).rows).toHaveLength(0);
    }
    expect((await h.db.query<{ merchant_id: string | null; status: string; gone: boolean }>("select merchant_id, status, merchant_deleted_at is not null as gone from merchant_applications where id = $1", [app.id])).rows[0]).toEqual({ merchant_id: null, status: "approved", gone: true });
    // The applicant is not locked out: they can apply again, and the TIN they held is free.
    const again = await h.asUser(applicant.id, (tx) => tx.query<{ id: string }>("select id from submit_merchant_application('Cafe 2', $1, 'Bole, Addis Ababa', '5550002223')", [category]));
    expect(again.rows).toHaveLength(1);
    expect((await h.db.query("select 1 from profiles where id = $1", [applicant.id])).rows).toHaveLength(1);
    expect((await audit(merchantId)).at(-1)).toMatchObject({ action: "delete", actor_id: admin.id });
  });
});
