// Migration 0075 (approve_merchant_application, merchant_status_for_phone)
// against in-process PGlite -- see tests/pglite/harness.ts.
import { beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness, type TestUser } from "./pglite/harness.ts";

let h: Harness;
let category: string;
let admin: TestUser;

beforeAll(async () => {
  h = await createHarness([
    "0072_tolo_phone_links.sql",
    "0073_merchant_applications.sql",
    "0074_merchant_application_licenses_storage.sql",
    "0075_merchant_application_approval.sql",
    "0090_merchant_category_id.sql",
  ]);
  category = await h.createCategory();
  admin = await h.createUser({ adminTier: "admin" });
});

async function apply(user: TestUser): Promise<string> {
  const license = await h.uploadLicense(user.id);
  const { rows } = await h.asUser(user.id, (tx) =>
    tx.query<{ id: string }>("select id from submit_merchant_application('Abebe''s Coffee', $1, 'Bole, Addis Ababa', $2)", [category, license]),
  );
  return rows[0].id;
}

function approve(applicationId: string, ownerId: string, reviewerId = admin.id, note: string | null = null) {
  return h.asService((tx) =>
    tx.query<{ merchant_id: string }>("select approve_merchant_application($1, $2, $3, $4) as merchant_id", [
      applicationId,
      ownerId,
      reviewerId,
      note,
    ]),
  );
}

function statusFor(phone: string) {
  return h
    .asService((tx) =>
      tx.query<{ application_status: string | null; is_merchant: boolean; merchant_id: string | null; admin_note: string | null }>(
        "select * from merchant_status_for_phone($1)",
        [phone],
      ),
    )
    .then((r) => r.rows[0]);
}

describe("approve_merchant_application", () => {
  it("creates an active merchant owned by the applicant and marks the application approved", async () => {
    const applicant = await h.createUser();
    const appId = await apply(applicant);
    const { rows } = await approve(appId, applicant.id, admin.id, "Welcome");
    const merchantId = rows[0].merchant_id;

    const merchant = await h.db.query<Record<string, unknown>>("select * from merchants where id = $1", [merchantId]);
    expect(merchant.rows[0]).toMatchObject({
      owner_id: applicant.id,
      business_name: "Abebe's Coffee",
      phone: applicant.phone,
      location: "Bole, Addis Ababa",
      status: "active",
      approved_by: admin.id,
    });
    // The category is a link now, not text copied into business_category (0090).
    expect(merchant.rows[0]).toMatchObject({ category_id: category, business_category: null });

    const app = await h.db.query<Record<string, unknown>>("select * from merchant_applications where id = $1", [appId]);
    expect(app.rows[0]).toMatchObject({ status: "approved", merchant_id: merchantId, reviewed_by: admin.id, admin_note: "Welcome" });
    expect(app.rows[0].reviewed_at).not.toBeNull();
  });

  it("can't be called by anyone but the service role -- not even an admin directly", async () => {
    const applicant = await h.createUser();
    const appId = await apply(applicant);
    await expect(
      h.asUser(admin.id, (tx) => tx.query("select approve_merchant_application($1, $2, $3, null)", [appId, admin.id, admin.id])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      h.asUser(applicant.id, (tx) => tx.query("select approve_merchant_application($1, $2, $3, null)", [appId, applicant.id, admin.id])),
    ).rejects.toThrow(/permission denied/);
  });

  it("refuses a reviewer that isn't admin tier", async () => {
    const applicant = await h.createUser();
    const appId = await apply(applicant);
    const staff = await h.createUser({ role: "tolo_merchant_verification" });
    await expect(approve(appId, applicant.id, staff.id)).rejects.toThrow("not_admin");
  });

  it("approves only once", async () => {
    const applicant = await h.createUser();
    const appId = await apply(applicant);
    await approve(appId, applicant.id);
    await expect(approve(appId, applicant.id)).rejects.toThrow("already_reviewed");
    const { rows } = await h.db.query("select id from merchants where owner_id = $1", [applicant.id]);
    expect(rows).toHaveLength(1);
  });

  it("refuses an owner that already has a merchant, and leaves the application pending", async () => {
    const applicant = await h.createUser();
    const first = await apply(applicant);
    await approve(first, applicant.id);

    const other = await h.createUser();
    const secondApp = await apply(other);
    await expect(approve(secondApp, applicant.id)).rejects.toThrow("already_merchant");
    const { rows } = await h.db.query<{ status: string }>("select status from merchant_applications where id = $1", [secondApp]);
    expect(rows[0].status).toBe("pending");
  });

  it("an approved applicant can't apply again", async () => {
    const applicant = await h.createUser();
    await approve(await apply(applicant), applicant.id);
    await expect(apply(applicant)).rejects.toThrow("already_merchant");
  });

  it("the approval bypass doesn't leak: a later direct flip to approved is still refused", async () => {
    const applicant = await h.createUser();
    await approve(await apply(applicant), applicant.id);
    const next = await h.createUser();
    const nextApp = await apply(next);
    await expect(
      h.asUser(admin.id, (tx) => tx.query("update merchant_applications set status = 'approved' where id = $1", [nextApp])),
    ).rejects.toThrow(/approve_merchant_application/);
  });
});

describe("merchant_status_for_phone (bridge signal)", () => {
  it("none -> pending -> approved, with is_merchant flipping only on approval", async () => {
    const applicant = await h.createUser();
    expect(await statusFor(applicant.phone!)).toMatchObject({ application_status: null, is_merchant: false });

    const appId = await apply(applicant);
    expect(await statusFor(applicant.phone!)).toMatchObject({ application_status: "pending", is_merchant: false });

    const { rows } = await approve(appId, applicant.id);
    expect(await statusFor(applicant.phone!)).toMatchObject({
      application_status: "approved",
      is_merchant: true,
      merchant_id: rows[0].merchant_id,
    });
  });

  it("reports a rejection with its note, then the newer application after reapplying", async () => {
    const applicant = await h.createUser();
    const appId = await apply(applicant);
    await h.asUser(admin.id, (tx) =>
      tx.query("update merchant_applications set status = 'rejected', admin_note = 'Blurry' where id = $1", [appId]),
    );
    expect(await statusFor(applicant.phone!)).toMatchObject({ application_status: "rejected", admin_note: "Blurry", is_merchant: false });

    await apply(applicant);
    expect(await statusFor(applicant.phone!)).toMatchObject({ application_status: "pending", is_merchant: false });
  });

  it("is_merchant goes false when the merchant is suspended", async () => {
    const applicant = await h.createUser();
    const { rows } = await approve(await apply(applicant), applicant.id);
    await h.db.query("update merchants set status = 'suspended' where id = $1", [rows[0].merchant_id]);
    expect(await statusFor(applicant.phone!)).toMatchObject({ application_status: "approved", is_merchant: false });
  });

  it("a merchant editing their profile phone to someone else's number doesn't make that number a merchant", async () => {
    const merchant = await h.createUser();
    await approve(await apply(merchant), merchant.id);
    const victim = await h.createUser();
    await h.asUser(merchant.id, (tx) => tx.query("update profiles set phone = $1 where id = $2", [victim.phone, merchant.id]));
    expect(await statusFor(victim.phone!)).toMatchObject({ application_status: null, is_merchant: false });
    expect(await statusFor(merchant.phone!)).toMatchObject({ is_merchant: true });
  });

  it("is service-role only", async () => {
    const applicant = await h.createUser();
    await expect(
      h.asUser(applicant.id, (tx) => tx.query("select * from merchant_status_for_phone($1)", [applicant.phone])),
    ).rejects.toThrow(/permission denied/);
  });
});
