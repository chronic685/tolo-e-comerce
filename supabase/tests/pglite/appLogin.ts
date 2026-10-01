// tolo-app-login's AppLoginDeps backed by PGlite instead of Supabase, so the
// REAL handleAppLogin() decision logic runs against the REAL migration SQL.
// Only two things are mocked, the same two tolo-app-login's own unit tests
// mock: the Tolo backend's verify-code call (a code -> phone table here)
// and session minting (GoTrue's job). Account creation mirrors index.ts's
// createCustomer step for step: auth user + profiles row (what
// auth.admin.createUser + handle_new_user() produce), profiles.phone for
// display, then link_tolo_phone() as the service role.
import { randomUUID } from "node:crypto";
import type { AppLoginDeps, MintedSession, VerifyResult } from "../../functions/tolo-app-login/logic.ts";
import type { MerchantLoginDeps } from "../../functions/tolo-merchant-login/logic.ts";
import type { Harness } from "./harness.ts";

export interface MockToloBackend {
  /** Issues a one-time code that verifies to `phone`, like the Tolo backend would. */
  issueCode(phone: string, name?: string): string;
  verifyCode(code: string): Promise<VerifyResult>;
}

export function mockToloBackend(): MockToloBackend {
  const codes = new Map<string, { phone: string; name: string; used: boolean }>();
  return {
    issueCode(phone, name = "Tolo User") {
      const code = randomUUID();
      codes.set(code, { phone, name, used: false });
      return code;
    },
    async verifyCode(code) {
      const entry = codes.get(code);
      if (!entry) return { valid: false, reason: "invalid_code" };
      if (entry.used) return { valid: false, reason: "already_used" };
      entry.used = true;
      return { valid: true, phone: entry.phone, name: entry.name };
    },
  };
}

/** Session minting is mocked: the "token" just names the account it's for. */
export function mockMintSession(userId: string): Promise<MintedSession> {
  return Promise.resolve({ access_token: `session-for:${userId}`, refresh_token: "rt", expires_in: 3600, token_type: "bearer" });
}

/** The phone-link deps shared by every Tolo-app login flow. */
export function pgliteLinkDeps(h: Harness) {
  return {
    async findLinkedAccount(phone: string) {
      const { rows } = await h.asService((tx) =>
        tx.query<{ user_id: string; is_staff_or_admin: boolean }>("select * from tolo_account_for_phone($1)", [phone]),
      );
      return rows[0] ? { id: rows[0].user_id, isStaffOrAdmin: rows[0].is_staff_or_admin } : null;
    },

    async createCustomer(phone: string, name: string) {
      const id = randomUUID();
      await h.db.query("insert into auth.users (id, email) values ($1, $2)", [id, `tolo-${randomUUID()}@app.tolo.internal`]);
      await h.db.query("insert into profiles (id, full_name) values ($1, $2)", [id, name]);
      try {
        await h.asService(async (tx) => {
          await tx.query("update profiles set phone = $1 where id = $2", [phone, id]);
          await tx.query("select link_tolo_phone($1, $2)", [id, phone]);
        });
      } catch {
        await h.db.query("delete from auth.users where id = $1", [id]);
        throw new Error("Could not create customer account.");
      }
      return { id };
    },

    async recordLogin(id: string) {
      await h.asService((tx) => tx.query("select record_tolo_login($1)", [id]));
    },
  };
}

export function pgliteAppLoginDeps(h: Harness, backend: MockToloBackend): AppLoginDeps {
  return { verifyCode: backend.verifyCode, ...pgliteLinkDeps(h), mintSession: mockMintSession };
}

/** tolo-merchant-login's deps over PGlite: real tolo_merchant_account_for_phone()
 * (migration 0076), mocked Tolo backend and session minting. */
export function pgliteMerchantLoginDeps(h: Harness, backend: MockToloBackend): MerchantLoginDeps {
  return {
    verifyCode: backend.verifyCode,
    async findMerchantAccount(phone) {
      const { rows } = await h.asService((tx) =>
        tx.query<{ user_id: string; merchant_id: string }>("select * from tolo_merchant_account_for_phone($1)", [phone]),
      );
      return rows[0] ? { userId: rows[0].user_id, merchantId: rows[0].merchant_id } : null;
    },
    recordLogin: pgliteLinkDeps(h).recordLogin,
    mintSession: mockMintSession,
  };
}
