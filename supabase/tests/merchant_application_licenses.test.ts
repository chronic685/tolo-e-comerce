// Migration 0074 (license photo bucket + storage policies) against
// in-process PGlite. Storage's own file type/size enforcement happens in
// the Storage API from the bucket's config, which PGlite can't run -- so
// that part is asserted as configuration, and the policies are exercised
// for real.
import { beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./pglite/harness.ts";

let h: Harness;

beforeAll(async () => {
  h = await createHarness(["0072_tolo_phone_links.sql", "0073_merchant_applications.sql", "0074_merchant_application_licenses_storage.sql"]);
});

function uploadAs(userId: string, path: string) {
  return h.asUser(userId, (tx) =>
    tx.query("insert into storage.objects (bucket_id, name) values ('merchant-application-licenses', $1)", [path]),
  );
}

describe("merchant-application-licenses bucket", () => {
  it("is private and only accepts JPEG/PNG/WebP up to 5 MB", async () => {
    const { rows } = await h.db.query<{ public: boolean; file_size_limit: number; allowed_mime_types: string[] }>(
      "select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'merchant-application-licenses'",
    );
    expect(rows[0]).toEqual({
      public: false,
      file_size_limit: 5 * 1024 * 1024,
      allowed_mime_types: ["image/jpeg", "image/png", "image/webp"],
    });
  });

  it("an applicant can upload into their own folder", async () => {
    const applicant = await h.createUser();
    await expect(uploadAs(applicant.id, `${applicant.id}/license.jpg`)).resolves.toBeDefined();
  });

  it("an applicant can't upload into another applicant's folder", async () => {
    const applicant = await h.createUser();
    const other = await h.createUser();
    await expect(uploadAs(applicant.id, `${other.id}/license.jpg`)).rejects.toThrow(/row-level security/);
  });

  it("an account without a Tolo phone link can't upload at all", async () => {
    const user = await h.createUser({ linked: false });
    await expect(uploadAs(user.id, `${user.id}/license.jpg`)).rejects.toThrow(/row-level security/);
  });

  it("only admin/super_admin can read license photos -- not the uploader, not page-permission staff", async () => {
    const applicant = await h.createUser();
    const path = `${applicant.id}/readable.jpg`;
    await uploadAs(applicant.id, path);
    const read = (userId: string) =>
      h.asUser(userId, (tx) => tx.query("select name from storage.objects where name = $1", [path])).then((r) => r.rows.length);

    const admin = await h.createUser({ adminTier: "admin" });
    const superAdmin = await h.createUser({ adminTier: "super_admin" });
    const staff = await h.createUser({ role: "tolo_merchant_verification" });
    await h.db.query(`update profiles set permissions = '["merchants"]' where id = $1`, [staff.id]);

    expect(await read(admin.id)).toBe(1);
    expect(await read(superAdmin.id)).toBe(1);
    expect(await read(applicant.id)).toBe(0);
    expect(await read(staff.id)).toBe(0);
  });

  it("uploaders can't overwrite or delete a license once uploaded", async () => {
    const applicant = await h.createUser();
    const path = `${applicant.id}/kept.jpg`;
    await uploadAs(applicant.id, path);
    const updated = await h.asUser(applicant.id, (tx) => tx.query("update storage.objects set name = name where name = $1", [path]));
    const deleted = await h.asUser(applicant.id, (tx) => tx.query("delete from storage.objects where name = $1", [path]));
    expect(updated.affectedRows).toBe(0);
    expect(deleted.affectedRows).toBe(0);
  });
});
