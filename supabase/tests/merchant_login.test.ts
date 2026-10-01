// Merchant sign-in from the Tolo app (tolo-merchant-login + migration 0076),
// end to end against the mocked Tolo backend: customer Tolo login ->
// application -> admin review -> merchant Tolo login. The REAL decision
// logic of all three Edge Functions runs against the REAL migrations in
// in-process PGlite; only the Tolo backend's verify-code and session
// minting are mocked (pglite/appLogin.ts).
import { beforeAll, describe, expect, it } from "vitest";
import { handleAppLogin } from "../functions/tolo-app-login/logic.ts";
import { handleMerchantAppLogin } from "../functions/tolo-merchant-login/logic.ts";
import { handleReview, type ReviewDeps } from "../functions/review-merchant-application/logic.ts";
import { createHarness, nextPhone, type Harness, type TestUser } from "./pglite/harness.ts";
import { mockToloBackend, pgliteAppLoginDeps, pgliteLinkDeps, pgliteMerchantLoginDeps, type MockToloBackend } from "./pglite/appLogin.ts";

let h: Harness;
let tolo: MockToloBackend;
let category: string;
let admin: TestUser;

beforeAll(async () => {
  h = await createHarness([
    "0072_tolo_phone_links.sql",
    "0073_merchant_applications.sql",
    "0074_merchant_application_licenses_storage.sql",
    "0075_merchant_application_approval.sql",
    "0076_tolo_merchant_login.sql",
  ]);
  tolo = mockToloBackend();
  category = await h.createCategory();
  admin = await h.createUser({ adminTier: "admin" });
});

// --- the three flows, each through its real Edge Function logic ----------

async function customerToloLogin(phone: string): Promise<string> {
  const result = await handleAppLogin(tolo.issueCode(phone), pgliteAppLoginDeps(h, tolo));
  if (!result.ok) throw new Error(`customer login failed: ${result.error}`);
  return result.userId;
}

function merchantToloLogin(phone: string) {
  return handleMerchantAppLogin(tolo.issueCode(phone), pgliteMerchantLoginDeps(h, tolo));
}

async function apply(userId: string): Promise<string> {
  const license = await h.uploadLicense(userId);
  const { rows } = await h.asUser(userId, (tx) =>
    tx.query<{ id: string }>("select id from submit_merchant_application('Abebe''s Coffee', $1, 'Bole, Addis Ababa', $2)", [category, license]),
  );
  return rows[0].id;
}

// review-merchant-application's deps over PGlite, mirroring its index.ts:
// approve through the service-role RPC, reject on the admin's own session.
function reviewDeps(callerId: string): ReviewDeps {
  return {
    ...pgliteLinkDeps(h),
    async getCaller() {
      const { rows } = await h.db.query<{ admin_tier: string | null; account_status: string }>(
        "select admin_tier, account_status from profiles where id = $1",
        [callerId],
      );
      return { id: callerId, isAdminTier: !!rows[0]?.admin_tier && rows[0].account_status === "active" };
    },
    async getApplication(id) {
      const { rows } = await h.db.query<Record<string, string>>(
        "select id, status, applicant_id, applicant_phone, business_name from merchant_applications where id = $1",
        [id],
      );
      const r = rows[0];
      return r
        ? { id: r.id, status: r.status as "pending", applicantId: r.applicant_id, applicantPhone: r.applicant_phone, businessName: r.business_name }
        : null;
    },
    async getProfile(id) {
      const { rows } = await h.db.query<{ id: string; role: string; admin_tier: string | null; account_status: string }>(
        "select id, role, admin_tier, account_status from profiles where id = $1",
        [id],
      );
      const p = rows[0];
      return p ? { id: p.id, isStaffOrAdmin: p.admin_tier != null || p.role.startsWith("tolo_"), active: p.account_status === "active" } : null;
    },
    async approve(applicationId, ownerId, reviewerId, note) {
      try {
        const { rows } = await h.asService((tx) =>
          tx.query<{ id: string }>("select approve_merchant_application($1, $2, $3, $4) as id", [applicationId, ownerId, reviewerId, note]),
        );
        return { ok: true, merchantId: rows[0].id };
      } catch (err) {
        const message = (err as Error).message;
        if (message === "not_found" || message === "already_reviewed" || message === "already_merchant") return { ok: false, error: message };
        throw err;
      }
    },
    async reject(applicationId, note) {
      const { affectedRows } = await h.asUser(callerId, (tx) =>
        tx.query("update merchant_applications set status = 'rejected', admin_note = $2 where id = $1 and status = 'pending'", [
          applicationId,
          note,
        ]),
      );
      return affectedRows ? { ok: true } : { ok: false, error: "not_found_or_reviewed" };
    },
  };
}

async function review(applicationId: string, action: "approve" | "reject") {
  const result = await handleReview({ application_id: applicationId, action }, reviewDeps(admin.id));
  if (!result.ok) throw new Error(`review failed: ${result.error}`);
  return result;
}

const FAILED = { ok: false, status: 401, error: "Sign-in failed." };

describe("merchant login, end to end against the mocked Tolo backend", () => {
  it("apply in the customer app -> admin approves -> Merchant button signs in to that merchant, no password", async () => {
    const phone = nextPhone();
    const customerId = await customerToloLogin(phone);

    const applicationId = await apply(customerId);
    expect(await merchantToloLogin(phone)).toEqual(FAILED); // pending: not yet

    const approved = await review(applicationId, "approve");
    if (approved.status !== "approved") throw new Error("expected approval");

    const result = await merchantToloLogin(phone);
    expect(result).toEqual({
      ok: true,
      userId: customerId,
      merchantId: approved.merchantId,
      session: expect.objectContaining({ access_token: `session-for:${customerId}` }),
    });

    // The session is for the account that owns the merchant -- which is
    // exactly what merchant-dashboard's MerchantContext loads on sign-in.
    const { rows } = await h.db.query<{ id: string; status: string }>("select id, status from merchants where owner_id = $1", [customerId]);
    expect(rows).toEqual([{ id: approved.merchantId, status: "active" }]);
    // And the customer login still reaches the same single account.
    expect(await customerToloLogin(phone)).toBe(customerId);
  });

  it("a rejected applicant can't sign in as a merchant, nor after reapplying until approved", async () => {
    const phone = nextPhone();
    const customerId = await customerToloLogin(phone);
    await review(await apply(customerId), "reject");
    expect(await merchantToloLogin(phone)).toEqual(FAILED);

    const second = await apply(customerId);
    expect(await merchantToloLogin(phone)).toEqual(FAILED);
    await review(second, "approve");
    expect(await merchantToloLogin(phone)).toMatchObject({ ok: true, userId: customerId });
  });

  it("a customer who never applied can't sign in as a merchant, and no account is created", async () => {
    const phone = nextPhone();
    await customerToloLogin(phone);
    const before = await h.db.query("select count(*)::int as n from auth.users");
    expect(await merchantToloLogin(phone)).toEqual(FAILED);
    expect(await merchantToloLogin(nextPhone())).toEqual(FAILED); // never-seen phone
    const after = await h.db.query("select count(*)::int as n from auth.users");
    expect(after.rows).toEqual(before.rows);
  });

  it("a reused code fails", async () => {
    const phone = nextPhone();
    const customerId = await customerToloLogin(phone);
    await review(await apply(customerId), "approve");
    const code = tolo.issueCode(phone);
    expect(await handleMerchantAppLogin(code, pgliteMerchantLoginDeps(h, tolo))).toMatchObject({ ok: true });
    expect(await handleMerchantAppLogin(code, pgliteMerchantLoginDeps(h, tolo))).toEqual(FAILED);
  });

  it("an approved merchant whose account later became staff/admin is refused", async () => {
    const phone = nextPhone();
    const customerId = await customerToloLogin(phone);
    await review(await apply(customerId), "approve");
    await h.db.query("update profiles set admin_tier = 'admin' where id = $1", [customerId]);
    expect(await merchantToloLogin(phone)).toEqual(FAILED);
  });
});

describe("merchant login can't be hijacked through an edited profile phone", () => {
  it("an approved merchant setting their profile phone to someone else's number doesn't get that person's merchant login", async () => {
    // The attacker is a real, approved merchant.
    const attackerPhone = nextPhone();
    const attackerId = await customerToloLogin(attackerPhone);
    await review(await apply(attackerId), "approve");

    // The victim is an ordinary Tolo customer.
    const victimPhone = nextPhone();
    await customerToloLogin(victimPhone);

    const edit = await h.asUser(attackerId, (tx) => tx.query("update profiles set phone = $1 where id = $2", [victimPhone, attackerId]));
    expect(edit.affectedRows).toBe(1);

    // The victim's Merchant button doesn't sign them in to the attacker's merchant.
    expect(await merchantToloLogin(victimPhone)).toEqual(FAILED);
    // The attacker still only reaches their own merchant via their own phone.
    expect(await merchantToloLogin(attackerPhone)).toMatchObject({ ok: true, userId: attackerId });
  });

  it("editing your profile phone to an approved merchant's number doesn't give you their merchant", async () => {
    const merchantPhone = nextPhone();
    const merchantId = await customerToloLogin(merchantPhone);
    await review(await apply(merchantId), "approve");

    const attacker = await h.createAuthUser();
    await h.asUser(attacker.id, (tx) => tx.query("update profiles set phone = $1 where id = $2", [merchantPhone, attacker.id]));

    const result = await merchantToloLogin(merchantPhone);
    expect(result).toMatchObject({ ok: true, userId: merchantId });
    expect(result).not.toMatchObject({ userId: attacker.id });
  });

  it("users can't call the merchant lookup themselves", async () => {
    const user = await h.createUser();
    await expect(h.asUser(user.id, (tx) => tx.query("select * from tolo_merchant_account_for_phone($1)", [user.phone]))).rejects.toThrow(
      /permission denied/,
    );
  });
});
