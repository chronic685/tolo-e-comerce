// Decision logic for the merchant sign-in handoff from the Tolo app's
// "Merchant" button -- the merchant equivalent of tolo-app-login/logic.ts,
// kept free of Deno/network/database code the same way so it runs under
// plain Vitest with every I/O dependency injected.
import { normalizeEthiopianPhone } from "../_shared/phone.ts";
import type { MintedSession, VerifyResult } from "../_shared/tolo_login_types.ts";

export interface MerchantAccount {
  userId: string;
  merchantId: string;
}

export interface MerchantLoginDeps {
  verifyCode(code: string): Promise<VerifyResult>;
  // The merchant account for this Tolo-verified phone: the account linked
  // to it in tolo_phone_links (never profiles.phone), only if the phone's
  // latest merchant application is approved and that merchant is owned by
  // the linked account (tolo_merchant_account_for_phone, migration 0076).
  findMerchantAccount(phone: string): Promise<MerchantAccount | null>;
  recordLogin(userId: string): Promise<void>;
  mintSession(userId: string): Promise<MintedSession>;
}

export type MerchantLoginResult =
  | { ok: true; userId: string; merchantId: string; session: MintedSession }
  | { ok: false; status: number; error: string };

// Same rule as the customer login: every rejection (bad/expired/reused
// code, unnormalizable phone, no link, application pending or rejected, a
// staff/admin account) looks identical from the outside.
const SIGN_IN_FAILED = "Sign-in failed.";

export async function handleMerchantAppLogin(code: unknown, deps: MerchantLoginDeps): Promise<MerchantLoginResult> {
  if (!code || typeof code !== "string") {
    return { ok: false, status: 400, error: "code is required." };
  }

  const verified = await deps.verifyCode(code);
  if (!verified.valid) {
    return { ok: false, status: 401, error: SIGN_IN_FAILED };
  }

  // Only the phone the Tolo backend just verified is trusted.
  const phone = normalizeEthiopianPhone(verified.phone);
  if (!phone) {
    return { ok: false, status: 401, error: SIGN_IN_FAILED };
  }

  // Unlike the customer login, this never creates an account: no approved
  // merchant for this phone means nothing to sign in to.
  const account = await deps.findMerchantAccount(phone);
  if (!account) {
    return { ok: false, status: 401, error: SIGN_IN_FAILED };
  }

  await deps.recordLogin(account.userId);
  const session = await deps.mintSession(account.userId);
  return { ok: true, userId: account.userId, merchantId: account.merchantId, session };
}
