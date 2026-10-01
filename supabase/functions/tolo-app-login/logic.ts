// Decision logic for the Tolo app login handoff, kept free of any Deno-,
// network-, or database-specific code so it can run under both the Deno
// edge runtime (index.ts) and a plain Node/Vitest process (logic.test.ts)
// with no special config. Every I/O side effect is injected via `deps` --
// this function only decides what should happen, never how.
import { normalizeEthiopianPhone } from "../_shared/phone.ts";
import { resolvePhoneAccount, type PhoneAccountDeps } from "../_shared/phone_account.ts";

import type { MintedSession, VerifyResult } from "../_shared/tolo_login_types.ts";

export type { LinkedAccount } from "../_shared/phone_account.ts";
export type { MintedSession, VerifyResult } from "../_shared/tolo_login_types.ts";

export interface AppLoginDeps extends PhoneAccountDeps {
  verifyCode(code: string): Promise<VerifyResult>;
  mintSession(userId: string): Promise<MintedSession>;
}

export type AppLoginResult =
  | { ok: true; userId: string; session: MintedSession }
  | { ok: false; status: number; error: string };

// Every rejection path (bad/expired/reused code, a phone the Tolo backend
// couldn't normalize, an admin/staff account) returns this exact same
// message and 401 -- the whole point is that none of these look different
// from the outside.
const SIGN_IN_FAILED = "Sign-in failed.";

export async function handleAppLogin(code: unknown, deps: AppLoginDeps): Promise<AppLoginResult> {
  if (!code || typeof code !== "string") {
    return { ok: false, status: 400, error: "code is required." };
  }

  const verified = await deps.verifyCode(code);
  if (!verified.valid) {
    return { ok: false, status: 401, error: SIGN_IN_FAILED };
  }

  // Only the phone the Tolo backend just verified is ever trusted here --
  // nothing from the original request reaches this point at all.
  const phone = normalizeEthiopianPhone(verified.phone);
  if (!phone) {
    return { ok: false, status: 401, error: SIGN_IN_FAILED };
  }

  const account = await resolvePhoneAccount(phone, verified.name, deps);
  if (!account.ok) {
    return { ok: false, status: 401, error: SIGN_IN_FAILED };
  }

  await deps.recordLogin(account.userId);
  const session = await deps.mintSession(account.userId);
  return { ok: true, userId: account.userId, session };
}
