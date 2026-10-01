import { describe, expect, it, vi } from "vitest";
import { handleMerchantAppLogin, type MerchantLoginDeps } from "./logic.ts";
import type { VerifyResult } from "../_shared/tolo_login_types.ts";

const SESSION = { access_token: "at", refresh_token: "rt", expires_in: 3600, token_type: "bearer" };
const FAILED = { ok: false, status: 401, error: "Sign-in failed." };

// Same injected-mock approach as tolo-app-login/logic.test.ts.
function makeDeps(overrides: Partial<MerchantLoginDeps> = {}): MerchantLoginDeps {
  return {
    verifyCode: vi.fn(async (): Promise<VerifyResult> => ({ valid: true, phone: "0912345678", name: "Abebe" })),
    findMerchantAccount: vi.fn(async () => ({ userId: "owner-id", merchantId: "merchant-id" })),
    recordLogin: vi.fn(async () => {}),
    mintSession: vi.fn(async () => SESSION),
    ...overrides,
  };
}

describe("handleMerchantAppLogin", () => {
  it("rejects a missing code before calling out anywhere", async () => {
    const deps = makeDeps();
    expect(await handleMerchantAppLogin("", deps)).toEqual({ ok: false, status: 400, error: "code is required." });
    expect(deps.verifyCode).not.toHaveBeenCalled();
  });

  it("signs an approved merchant in, looking them up by the normalized verified phone", async () => {
    const deps = makeDeps();
    expect(await handleMerchantAppLogin("code", deps)).toEqual({ ok: true, userId: "owner-id", merchantId: "merchant-id", session: SESSION });
    expect(deps.findMerchantAccount).toHaveBeenCalledWith("+251912345678");
    expect(deps.mintSession).toHaveBeenCalledWith("owner-id");
  });

  it("fails generically -- and mints nothing -- when the phone has no approved merchant", async () => {
    const deps = makeDeps({ findMerchantAccount: vi.fn(async () => null) });
    expect(await handleMerchantAppLogin("code", deps)).toEqual(FAILED);
    expect(deps.mintSession).not.toHaveBeenCalled();
  });

  it("fails generically for invalid, expired, and reused codes", async () => {
    for (const reason of ["invalid_code", "expired_code", "already_used"] as const) {
      const deps = makeDeps({ verifyCode: vi.fn(async (): Promise<VerifyResult> => ({ valid: false, reason })) });
      expect(await handleMerchantAppLogin("code", deps)).toEqual(FAILED);
      expect(deps.findMerchantAccount).not.toHaveBeenCalled();
    }
  });

  it("fails generically when the backend's phone can't be normalized", async () => {
    const deps = makeDeps({ verifyCode: vi.fn(async (): Promise<VerifyResult> => ({ valid: true, phone: "nope", name: "X" })) });
    expect(await handleMerchantAppLogin("code", deps)).toEqual(FAILED);
    expect(deps.findMerchantAccount).not.toHaveBeenCalled();
  });
});
