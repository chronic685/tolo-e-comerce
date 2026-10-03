// Decision logic for the Tolo app's "show the Merchant button?" check
// (docs/integration/tolo-app.md), free of Deno/network/database code so it
// runs under plain Vitest -- same split as tolo-app-login/logic.ts.
import { constantTimeEqual } from "../_shared/inbound_auth.ts";
import { normalizeEthiopianPhone } from "../_shared/phone.ts";

export interface PhoneStatusRow {
  application_id: string | null;
  application_status: "pending" | "approved" | "rejected" | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  admin_note: string | null;
  is_merchant: boolean;
  merchant_id: string | null;
}

export interface StatusDeps {
  lookup(phone: string): Promise<PhoneStatusRow>;
}

export interface StatusRequest {
  authorization: string | null;
  // TOLO_BACKEND_INBOUND_KEY; undefined when the secret isn't set.
  expectedKey: string | undefined;
  body: unknown;
}

export type StatusResult = { ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string };

export { constantTimeEqual };

export async function handleStatus(req: StatusRequest, deps: StatusDeps): Promise<StatusResult> {
  if (!req.expectedKey) {
    return { ok: false, status: 503, error: "Not configured." };
  }
  if (!req.authorization || !constantTimeEqual(req.authorization, `Bearer ${req.expectedKey}`)) {
    return { ok: false, status: 401, error: "Unauthorized." };
  }

  const rawPhone = (req.body as { phone?: unknown } | null)?.phone;
  const phone = typeof rawPhone === "string" ? normalizeEthiopianPhone(rawPhone) : null;
  if (!phone) {
    return { ok: false, status: 400, error: "phone must be a valid Ethiopian mobile number." };
  }

  const row = await deps.lookup(phone);
  return {
    ok: true,
    body: {
      phone,
      is_merchant: row.is_merchant,
      application: row.application_status
        ? {
            id: row.application_id,
            status: row.application_status,
            submitted_at: row.submitted_at,
            reviewed_at: row.reviewed_at,
            // Only a rejection's note is meant for the applicant (it tells
            // them what to fix before reapplying); an approval note is
            // internal.
            note: row.application_status === "rejected" ? row.admin_note : null,
          }
        : null,
    },
  };
}
