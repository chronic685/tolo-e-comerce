// Migration 0073 (merchant_applications) run for real against in-process
// PGlite -- see tests/pglite/harness.ts. Never touches any Supabase project.
import { beforeAll, describe, expect, it } from "vitest";
import type { Transaction } from "@electric-sql/pglite";
import { createHarness, type Harness, type TestUser } from "./pglite/harness.ts";

let h: Harness;
let category: string;

beforeAll(async () => {
  h = await createHarness(["0072_tolo_phone_links.sql", "0073_merchant_applications.sql"]);
  category = await h.createCategory();
});

interface AppRow {
  id: string;
  applicant_id: string;
  applicant_phone: string;
  status: string;
  admin_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
}

function submit(tx: Transaction, license: string, overrides: { business?: string; category?: string; address?: string } = {}) {
  return tx.query<AppRow>("select * from submit_merchant_application($1, $2, $3, $4)", [
    overrides.business ?? "Abebe's Coffee",
    overrides.category ?? category,
    overrides.address ?? "Bole, Addis Ababa",
    license,
  ]);
}

async function submitAs(user: TestUser, overrides?: Parameters<typeof submit>[2]): Promise<AppRow> {
  const license = await h.uploadLicense(user.id);
  const { rows } = await h.asUser(user.id, (tx) => submit(tx, license, overrides));
  return rows[0];
}

describe("submit_merchant_application", () => {
  it("creates a pending application carrying the session's verified phone", async () => {
    const applicant = await h.createUser();
    const app = await submitAs(applicant);
    expect(app.status).toBe("pending");
    expect(app.applicant_id).toBe(applicant.id);
    expect(app.applicant_phone).toBe(applicant.phone);
  });

  it("refuses an account with no Tolo phone link, even if its profile claims a verified phone", async () => {
    // profiles.phone is set (and self-editable) but the account has no
    // tolo_phone_links row -- only the latter counts.
    const user = await h.createUser({ linked: false });
    await h.db.query("update profiles set phone_verified = true where id = $1", [user.id]);
    const license = await h.uploadLicense(user.id);
    await expect(h.asUser(user.id, (tx) => submit(tx, license))).rejects.toThrow("phone_not_verified");
  });

  it("refuses anonymous callers outright", async () => {
    await expect(h.asAnon((tx) => tx.query("select submit_merchant_application('x', $1, 'y', 'z')", [category]))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("can't apply twice while an application is pending", async () => {
    const applicant = await h.createUser();
    await submitAs(applicant);
    await expect(submitAs(applicant, { business: "Second try" })).rejects.toThrow("application_pending");
  });

  it("the pending-uniqueness rule is a real constraint, not only the function's pre-check", async () => {
    const applicant = await h.createUser();
    const first = await submitAs(applicant);
    await expect(
      h.db.query(
        "insert into merchant_applications (applicant_id, applicant_phone, business_name, category_id, address, license_photo_url) values ($1, $2, 'Dup', $3, 'Some address', 'x/y.jpg')",
        [applicant.id, first.applicant_phone, category],
      ),
    ).rejects.toThrow(/idx_merchant_applications_one_pending/);
  });

  it("refuses a license photo from someone else's folder", async () => {
    const victim = await h.createUser();
    const attacker = await h.createUser();
    const victimsLicense = await h.uploadLicense(victim.id);
    await expect(h.asUser(attacker.id, (tx) => submit(tx, victimsLicense))).rejects.toThrow("invalid_license_photo");
  });

  it("refuses a license path that was never uploaded", async () => {
    const applicant = await h.createUser();
    await expect(h.asUser(applicant.id, (tx) => submit(tx, `${applicant.id}/never-uploaded.jpg`))).rejects.toThrow(
      "invalid_license_photo",
    );
  });

  it("refuses an inactive category", async () => {
    const applicant = await h.createUser();
    const inactive = await h.createCategory({ isActive: false });
    await expect(submitAs(applicant, { category: inactive })).rejects.toThrow("invalid_category");
  });

  it("refuses blank details", async () => {
    const applicant = await h.createUser();
    await expect(submitAs(applicant, { business: "  " })).rejects.toThrow("invalid_details");
  });

  it("refuses a suspended account", async () => {
    const applicant = await h.createUser();
    await h.db.query("update profiles set account_status = 'suspended' where id = $1", [applicant.id]);
    await expect(submitAs(applicant)).rejects.toThrow("account_inactive");
  });

  it("applicants can't insert directly, bypassing the function", async () => {
    const applicant = await h.createUser();
    await expect(
      h.asUser(applicant.id, (tx) =>
        tx.query(
          "insert into merchant_applications (applicant_id, applicant_phone, business_name, category_id, address, license_photo_url) values ($1, $2, 'Direct', $3, 'Some address', 'x/y.jpg')",
          [applicant.id, applicant.phone, category],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("reading applications (RLS)", () => {
  it("an applicant sees only their own application, never another applicant's", async () => {
    const alice = await h.createUser();
    const bob = await h.createUser();
    const alicesApp = await submitAs(alice);
    const bobsApp = await submitAs(bob);

    const seenByAlice = await h.asUser(alice.id, (tx) => tx.query<AppRow>("select id from merchant_applications"));
    expect(seenByAlice.rows.map((r) => r.id)).toEqual([alicesApp.id]);

    const direct = await h.asUser(alice.id, (tx) => tx.query("select id from merchant_applications where id = $1", [bobsApp.id]));
    expect(direct.rows).toEqual([]);
  });

  it("matching is by the session's Tolo phone link, so a self-edited profiles.phone grants nothing", async () => {
    const victim = await h.createUser();
    await submitAs(victim);
    const attacker = await h.createUser();
    await h.asUser(attacker.id, (tx) =>
      tx.query("update profiles set phone = $1, phone_verified = true where id = $2", [victim.phone, attacker.id]),
    );
    const seen = await h.asUser(attacker.id, (tx) => tx.query("select id from merchant_applications"));
    expect(seen.rows).toEqual([]);
  });

  it("anon sees nothing", async () => {
    const applicant = await h.createUser();
    await submitAs(applicant);
    const seen = await h.asAnon((tx) => tx.query("select id from merchant_applications"));
    expect(seen.rows).toEqual([]);
  });

  it("admin and super_admin see every application; page-permission staff don't", async () => {
    const applicant = await h.createUser();
    const app = await submitAs(applicant);
    const admin = await h.createUser({ adminTier: "admin" });
    const superAdmin = await h.createUser({ adminTier: "super_admin" });
    const staff = await h.createUser({ role: "tolo_merchant_verification" });
    await h.db.query(`update profiles set permissions = '["merchants"]' where id = $1`, [staff.id]);

    for (const reviewer of [admin, superAdmin]) {
      const seen = await h.asUser(reviewer.id, (tx) => tx.query("select id from merchant_applications where id = $1", [app.id]));
      expect(seen.rows).toHaveLength(1);
    }
    const seenByStaff = await h.asUser(staff.id, (tx) => tx.query("select id from merchant_applications where id = $1", [app.id]));
    expect(seenByStaff.rows).toEqual([]);
  });
});

describe("reviewing (RLS + guard trigger)", () => {
  it("an admin can reject with a note; the review is stamped with who and when", async () => {
    const applicant = await h.createUser();
    const app = await submitAs(applicant);
    const admin = await h.createUser({ adminTier: "admin" });

    const { rows } = await h.asUser(admin.id, (tx) =>
      tx.query<AppRow>("update merchant_applications set status = 'rejected', admin_note = 'Blurry license' where id = $1 returning *", [
        app.id,
      ]),
    );
    expect(rows[0].status).toBe("rejected");
    expect(rows[0].admin_note).toBe("Blurry license");
    expect(rows[0].reviewed_by).toBe(admin.id);
    expect(rows[0].reviewed_at).not.toBeNull();
  });

  it("a rejected applicant can reapply", async () => {
    const applicant = await h.createUser();
    const first = await submitAs(applicant);
    const admin = await h.createUser({ adminTier: "admin" });
    await h.asUser(admin.id, (tx) => tx.query("update merchant_applications set status = 'rejected' where id = $1", [first.id]));

    const second = await submitAs(applicant, { business: "Abebe's Coffee (clearer photo)" });
    expect(second.status).toBe("pending");
    expect(second.id).not.toBe(first.id);
  });

  it("the applicant can't change status, notes, or their own details", async () => {
    const applicant = await h.createUser();
    const app = await submitAs(applicant);
    const { affectedRows } = await h.asUser(applicant.id, (tx) =>
      tx.query("update merchant_applications set status = 'rejected', admin_note = 'self' where id = $1", [app.id]),
    );
    expect(affectedRows).toBe(0);
  });

  it("page-permission staff can't review", async () => {
    const applicant = await h.createUser();
    const app = await submitAs(applicant);
    const staff = await h.createUser({ role: "tolo_merchant_verification" });
    await h.db.query(`update profiles set permissions = '["merchants"]' where id = $1`, [staff.id]);
    const { affectedRows } = await h.asUser(staff.id, (tx) =>
      tx.query("update merchant_applications set status = 'rejected' where id = $1", [app.id]),
    );
    expect(affectedRows).toBe(0);
  });

  it("even an admin can't flip status to approved directly (that would skip creating the merchant)", async () => {
    const applicant = await h.createUser();
    const app = await submitAs(applicant);
    const admin = await h.createUser({ adminTier: "admin" });
    await expect(
      h.asUser(admin.id, (tx) => tx.query("update merchant_applications set status = 'approved' where id = $1", [app.id])),
    ).rejects.toThrow(/approve_merchant_application/);
  });

  it("a reviewed application can't be re-reviewed, and submitted details are immutable", async () => {
    const applicant = await h.createUser();
    const app = await submitAs(applicant);
    const admin = await h.createUser({ adminTier: "admin" });
    await h.asUser(admin.id, (tx) => tx.query("update merchant_applications set status = 'rejected' where id = $1", [app.id]));

    await expect(
      h.asUser(admin.id, (tx) => tx.query("update merchant_applications set status = 'pending' where id = $1", [app.id])),
    ).rejects.toThrow(/already been reviewed/);
    await expect(
      h.asUser(admin.id, (tx) => tx.query("update merchant_applications set business_name = 'Edited' where id = $1", [app.id])),
    ).rejects.toThrow(/can't be changed/);
  });
});
