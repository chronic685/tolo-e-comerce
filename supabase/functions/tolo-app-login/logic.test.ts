import { describe, expect, it, vi } from "vitest";
import { handleAppLogin, type AppLoginDeps, type MatchedProfile, type VerifyResult } from "./logic.ts";

const VALID_PHONE = "+251912345678";
const SESSION = { access_token: "at", refresh_token: "rt", expires_in: 3600, token_type: "bearer" };

function makeDeps(overrides: Partial<AppLoginDeps> & { profiles?: MatchedProfile[] } = {}): AppLoginDeps {
  const { profiles = [], ...rest } = overrides;
  return {
    verifyCode: vi.fn(async (): Promise<VerifyResult> => ({ valid: true, phone: VALID_PHONE, name: "Abebe Kebede" })),
    findProfilesByPhone: vi.fn(async () => profiles),
    createCustomer: vi.fn(async () => ({ id: "new-customer-id" })),
    markPhoneVerified: vi.fn(async () => {}),
    mintSession: vi.fn(async () => SESSION),
    ...rest,
  };
}

describe("handleAppLogin", () => {
  it("rejects a missing code before calling out anywhere", async () => {
    const deps = makeDeps();
    const result = await handleAppLogin("", deps);
    expect(result).toEqual({ ok: false, status: 400, error: "code is required." });
    expect(deps.verifyCode).not.toHaveBeenCalled();
  });

  it("signs in with a valid code for an unknown phone by creating a customer", async () => {
    const deps = makeDeps({ profiles: [] });
    const result = await handleAppLogin("valid-code", deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.userId).toBe("new-customer-id");
    expect(result.session).toEqual(SESSION);
    expect(deps.createCustomer).toHaveBeenCalledWith(VALID_PHONE, "Abebe Kebede");
    expect(deps.markPhoneVerified).toHaveBeenCalledWith("new-customer-id");
  });

  it("matches an existing customer by phone instead of creating a new one", async () => {
    const deps = makeDeps({ profiles: [{ id: "existing-customer-id", isStaffOrAdmin: false }] });
    const result = await handleAppLogin("valid-code", deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.userId).toBe("existing-customer-id");
    expect(deps.createCustomer).not.toHaveBeenCalled();
    expect(deps.markPhoneVerified).toHaveBeenCalledWith("existing-customer-id");
  });

  it("rejects a reused code with the generic message", async () => {
    const deps = makeDeps({
      verifyCode: vi.fn(async (): Promise<VerifyResult> => ({ valid: false, reason: "already_used" })),
    });
    const result = await handleAppLogin("reused-code", deps);
    expect(result).toEqual({ ok: false, status: 401, error: "Sign-in failed." });
    expect(deps.findProfilesByPhone).not.toHaveBeenCalled();
  });

  it("rejects an expired code with the generic message", async () => {
    const deps = makeDeps({
      verifyCode: vi.fn(async (): Promise<VerifyResult> => ({ valid: false, reason: "expired_code" })),
    });
    const result = await handleAppLogin("expired-code", deps);
    expect(result).toEqual({ ok: false, status: 401, error: "Sign-in failed." });
  });

  it("rejects an invalid code with the generic message", async () => {
    const deps = makeDeps({
      verifyCode: vi.fn(async (): Promise<VerifyResult> => ({ valid: false, reason: "invalid_code" })),
    });
    const result = await handleAppLogin("bogus-code", deps);
    expect(result).toEqual({ ok: false, status: 401, error: "Sign-in failed." });
  });

  it("rejects a phone that belongs to a staff/admin account, even though it verified", async () => {
    const deps = makeDeps({ profiles: [{ id: "admin-id", isStaffOrAdmin: true }] });
    const result = await handleAppLogin("valid-code", deps);
    expect(result).toEqual({ ok: false, status: 401, error: "Sign-in failed." });
    expect(deps.createCustomer).not.toHaveBeenCalled();
    expect(deps.mintSession).not.toHaveBeenCalled();
  });

  it("rejects when the backend's phone can't be normalized, without ever creating an account", async () => {
    const deps = makeDeps({
      verifyCode: vi.fn(async (): Promise<VerifyResult> => ({ valid: true, phone: "not-a-real-phone", name: "Someone" })),
    });
    const result = await handleAppLogin("valid-code", deps);
    expect(result).toEqual({ ok: false, status: 401, error: "Sign-in failed." });
    expect(deps.findProfilesByPhone).not.toHaveBeenCalled();
    expect(deps.createCustomer).not.toHaveBeenCalled();
  });
});
