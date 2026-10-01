// "Which marketplace account does this Tolo-verified phone sign in to?" --
// the one rule shared by every flow that starts from a phone the Tolo
// backend has verified: the customer login handoff (tolo-app-login) and
// merchant application approval (review-merchant-application). Kept free
// of Deno-, network-, or database-specific code so it runs under plain
// Vitest with every I/O dependency injected.
//
// Matching goes ONLY through tolo_phone_links (migration 0072), which no
// user can write -- never through the self-editable profiles.phone.

export interface LinkedAccount {
  id: string;
  isStaffOrAdmin: boolean;
}

export interface PhoneAccountDeps {
  // The account linked to this verified phone, or null.
  findLinkedAccount(phone: string): Promise<LinkedAccount | null>;
  // Creates a new customer AND links it to `phone`.
  createCustomer(phone: string, name: string): Promise<{ id: string }>;
  recordLogin(id: string): Promise<void>;
}

export type PhoneAccountResult = { ok: true; userId: string; created: boolean } | { ok: false; reason: "staff_or_admin" };

// `phone` must already be normalized (see phone.ts) and must come from the
// Tolo backend -- never from a request body.
export async function resolvePhoneAccount(phone: string, name: string, deps: PhoneAccountDeps): Promise<PhoneAccountResult> {
  const linked = await deps.findLinkedAccount(phone);
  // Staff/admin accounts are never reachable through a phone-verified flow.
  if (linked?.isStaffOrAdmin) return { ok: false, reason: "staff_or_admin" };
  if (linked) return { ok: true, userId: linked.id, created: false };
  return { ok: true, userId: (await deps.createCustomer(phone, name)).id, created: true };
}
