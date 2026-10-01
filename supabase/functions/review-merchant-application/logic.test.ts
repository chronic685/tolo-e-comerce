import { describe, expect, it, vi } from "vitest";
import { handleReview, type ApplicationRecord, type ReviewDeps } from "./logic.ts";

const APP_ID = "11111111-1111-4111-8111-111111111111";
const PHONE = "+251912345678";
const ADMIN = { id: "admin-id", isAdminTier: true };

const PENDING: ApplicationRecord = {
  id: APP_ID,
  status: "pending",
  applicantId: "applicant-id",
  applicantPhone: PHONE,
  businessName: "Abebe's Coffee",
};

// Same injected-mock approach as tolo-app-login/logic.test.ts: the verified
// phone is whatever the application carries, every I/O call is a vi.fn.
function makeDeps(overrides: Partial<ReviewDeps> = {}): ReviewDeps {
  return {
    getCaller: vi.fn(async () => ADMIN),
    getApplication: vi.fn(async () => PENDING),
    getProfile: vi.fn(async (id: string) => ({ id, isStaffOrAdmin: false, active: true })),
    approve: vi.fn(async () => ({ ok: true as const, merchantId: "merchant-id" })),
    reject: vi.fn(async () => ({ ok: true as const })),
    findLinkedAccount: vi.fn(async () => null),
    createCustomer: vi.fn(async () => ({ id: "new-account-id" })),
    recordLogin: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("handleReview -- permissions", () => {
  it("rejects an unauthenticated caller", async () => {
    const deps = makeDeps({ getCaller: vi.fn(async () => null) });
    expect(await handleReview({ application_id: APP_ID, action: "approve" }, deps)).toMatchObject({ ok: false, status: 401 });
    expect(deps.approve).not.toHaveBeenCalled();
  });

  it("a non-admin (customer or page-permission staff) cannot approve", async () => {
    const deps = makeDeps({ getCaller: vi.fn(async () => ({ id: "staff-id", isAdminTier: false })) });
    expect(await handleReview({ application_id: APP_ID, action: "approve" }, deps)).toMatchObject({ ok: false, status: 403 });
    expect(deps.getApplication).not.toHaveBeenCalled();
    expect(deps.approve).not.toHaveBeenCalled();
    expect(deps.createCustomer).not.toHaveBeenCalled();
  });

  it("a non-admin cannot reject either", async () => {
    const deps = makeDeps({ getCaller: vi.fn(async () => ({ id: "staff-id", isAdminTier: false })) });
    expect(await handleReview({ application_id: APP_ID, action: "reject" }, deps)).toMatchObject({ ok: false, status: 403 });
    expect(deps.reject).not.toHaveBeenCalled();
  });
});

describe("handleReview -- input", () => {
  it("requires a UUID application_id and a known action", async () => {
    const deps = makeDeps();
    expect(await handleReview({ application_id: "nope", action: "approve" }, deps)).toMatchObject({ status: 400 });
    expect(await handleReview({ application_id: APP_ID, action: "delete" }, deps)).toMatchObject({ status: 400 });
    expect(await handleReview(null, deps)).toMatchObject({ status: 400 });
  });

  it("caps the note length", async () => {
    const deps = makeDeps();
    expect(await handleReview({ application_id: APP_ID, action: "reject", note: "x".repeat(1001) }, deps)).toMatchObject({ status: 400 });
  });
});

describe("handleReview -- approve", () => {
  it("creates the merchant for the applicant's own account, with the admin as reviewer", async () => {
    const deps = makeDeps();
    const result = await handleReview({ application_id: APP_ID, action: "approve", note: "  Looks good  " }, deps);
    expect(result).toEqual({ ok: true, status: "approved", merchantId: "merchant-id", ownerId: "applicant-id" });
    expect(deps.approve).toHaveBeenCalledWith(APP_ID, "applicant-id", "admin-id", "Looks good");
    // The applicant already has a phone-verified account: no new account.
    expect(deps.createCustomer).not.toHaveBeenCalled();
  });

  it("if the applicant's account is gone, creates one for the verified phone exactly as tolo-app-login would (linked to the phone)", async () => {
    const deps = makeDeps({ getProfile: vi.fn(async () => null) });
    const result = await handleReview({ application_id: APP_ID, action: "approve" }, deps);
    expect(result).toMatchObject({ ok: true, ownerId: "new-account-id" });
    expect(deps.findLinkedAccount).toHaveBeenCalledWith(PHONE);
    expect(deps.createCustomer).toHaveBeenCalledWith(PHONE, "Abebe's Coffee");
    expect(deps.approve).toHaveBeenCalledWith(APP_ID, "new-account-id", "admin-id", null);
  });

  it("if the applicant's account is gone but another account is now linked to the phone, uses that one", async () => {
    const deps = makeDeps({
      getProfile: vi.fn(async () => null),
      findLinkedAccount: vi.fn(async () => ({ id: "existing-id", isStaffOrAdmin: false })),
    });
    expect(await handleReview({ application_id: APP_ID, action: "approve" }, deps)).toMatchObject({ ok: true, ownerId: "existing-id" });
    expect(deps.createCustomer).not.toHaveBeenCalled();
  });

  it("never makes a staff/admin account a merchant owner", async () => {
    const deps = makeDeps({ getProfile: vi.fn(async (id: string) => ({ id, isStaffOrAdmin: true, active: true })) });
    expect(await handleReview({ application_id: APP_ID, action: "approve" }, deps)).toMatchObject({ ok: false, status: 422 });
    expect(deps.approve).not.toHaveBeenCalled();

    const viaPhone = makeDeps({
      getProfile: vi.fn(async () => null),
      findLinkedAccount: vi.fn(async () => ({ id: "admin-id", isStaffOrAdmin: true })),
    });
    expect(await handleReview({ application_id: APP_ID, action: "approve" }, viaPhone)).toMatchObject({ ok: false, status: 422 });
    expect(viaPhone.approve).not.toHaveBeenCalled();
  });

  it("refuses a suspended applicant", async () => {
    const deps = makeDeps({ getProfile: vi.fn(async (id: string) => ({ id, isStaffOrAdmin: false, active: false })) });
    expect(await handleReview({ application_id: APP_ID, action: "approve" }, deps)).toMatchObject({ ok: false, status: 422 });
  });

  it("refuses an application that's already been reviewed or doesn't exist", async () => {
    const reviewed = makeDeps({ getApplication: vi.fn(async () => ({ ...PENDING, status: "rejected" as const })) });
    expect(await handleReview({ application_id: APP_ID, action: "approve" }, reviewed)).toMatchObject({ status: 409 });
    const missing = makeDeps({ getApplication: vi.fn(async () => null) });
    expect(await handleReview({ application_id: APP_ID, action: "approve" }, missing)).toMatchObject({ status: 404 });
  });

  it("surfaces a lost race / existing merchant from the database as a conflict", async () => {
    const raced = makeDeps({ approve: vi.fn(async () => ({ ok: false as const, error: "already_reviewed" as const })) });
    expect(await handleReview({ application_id: APP_ID, action: "approve" }, raced)).toMatchObject({ status: 409 });
    const owner = makeDeps({ approve: vi.fn(async () => ({ ok: false as const, error: "already_merchant" as const })) });
    expect(await handleReview({ application_id: APP_ID, action: "approve" }, owner)).toMatchObject({
      status: 409,
      error: "The applicant already owns a merchant account.",
    });
  });
});

describe("handleReview -- reject", () => {
  it("rejects with an optional note and never creates anything", async () => {
    const deps = makeDeps();
    expect(await handleReview({ application_id: APP_ID, action: "reject", note: "Blurry license" }, deps)).toEqual({
      ok: true,
      status: "rejected",
    });
    expect(deps.reject).toHaveBeenCalledWith(APP_ID, "Blurry license");
    expect(deps.approve).not.toHaveBeenCalled();
    expect(deps.createCustomer).not.toHaveBeenCalled();
  });

  it("reports an already-reviewed application as a conflict", async () => {
    const deps = makeDeps({ reject: vi.fn(async () => ({ ok: false as const, error: "not_found_or_reviewed" as const })) });
    expect(await handleReview({ application_id: APP_ID, action: "reject" }, deps)).toMatchObject({ ok: false, status: 409 });
  });
});
