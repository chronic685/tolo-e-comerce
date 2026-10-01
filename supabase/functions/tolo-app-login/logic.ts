// Decision logic for the Tolo app login handoff, kept free of any Deno-,
// network-, or database-specific code so it can run under both the Deno
// edge runtime (index.ts) and a plain Node/Vitest process (logic.test.ts)
// with no special config. Every I/O side effect is injected via `deps` --
// this function only decides what should happen, never how.
import { normalizeEthiopianPhone } from "./phone.ts";

export type VerifyResult =
  | { valid: true; phone: string; name: string }
  | { valid: false; reason: "invalid_code" | "expired_code" | "already_used" | "unknown" };

export interface LinkedAccount {
  id: string;
  isStaffOrAdmin: boolean;
}

export interface MintedSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

export interface AppLoginDeps {
  verifyCode(code: string): Promise<VerifyResult>;
  // The account linked to this Tolo-verified phone (tolo_phone_links,
  // migration 0072), or null. Must never consult profiles.phone, which
  // every account can rewrite on its own row.
  findLinkedAccount(phone: string): Promise<LinkedAccount | null>;
  // Creates a new customer AND links it to `phone`.
  createCustomer(phone: string, name: string): Promise<{ id: string }>;
  recordLogin(id: string): Promise<void>;
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

  const linked = await deps.findLinkedAccount(phone);
  if (linked?.isStaffOrAdmin) {
    return { ok: false, status: 401, error: SIGN_IN_FAILED };
  }

  const userId = linked ? linked.id : (await deps.createCustomer(phone, verified.name)).id;

  await deps.recordLogin(userId);
  const session = await deps.mintSession(userId);
  return { ok: true, userId, session };
}
