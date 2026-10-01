// Decision logic for reviewing a merchant application, free of Deno/network/
// database code (same split as tolo-app-login/logic.ts) so it runs under
// plain Vitest with every I/O dependency injected.
import { resolvePhoneAccount, type PhoneAccountDeps } from "../_shared/phone_account.ts";

export interface Caller {
  id: string;
  // Admin or super_admin, and active. Plain staff never qualify, whatever
  // their page permissions (migration 0073).
  isAdminTier: boolean;
}

export interface ApplicationRecord {
  id: string;
  status: "pending" | "approved" | "rejected";
  applicantId: string;
  applicantPhone: string;
  businessName: string;
}

export interface ApplicantProfile {
  id: string;
  isStaffOrAdmin: boolean;
  active: boolean;
}

export type ApproveOutcome = { ok: true; merchantId: string } | { ok: false; error: "not_found" | "already_reviewed" | "already_merchant" };
export type RejectOutcome = { ok: true } | { ok: false; error: "not_found_or_reviewed" };

export interface ReviewDeps extends PhoneAccountDeps {
  getCaller(): Promise<Caller | null>;
  getApplication(id: string): Promise<ApplicationRecord | null>;
  getProfile(id: string): Promise<ApplicantProfile | null>;
  approve(applicationId: string, ownerId: string, reviewerId: string, note: string | null): Promise<ApproveOutcome>;
  reject(applicationId: string, note: string | null): Promise<RejectOutcome>;
}

export type ReviewResult =
  | { ok: true; status: "approved"; merchantId: string; ownerId: string }
  | { ok: true; status: "rejected" }
  | { ok: false; status: number; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleReview(body: unknown, deps: ReviewDeps): Promise<ReviewResult> {
  const caller = await deps.getCaller();
  if (!caller) return { ok: false, status: 401, error: "Not authenticated." };
  if (!caller.isAdminTier) {
    return { ok: false, status: 403, error: "Only an active admin or super admin can review merchant applications." };
  }

  const { application_id, action, note } = (body ?? {}) as Record<string, unknown>;
  if (typeof application_id !== "string" || !UUID.test(application_id) || (action !== "approve" && action !== "reject")) {
    return { ok: false, status: 400, error: "application_id and action ('approve' or 'reject') are required." };
  }
  if (note != null && (typeof note !== "string" || note.length > 1000)) {
    return { ok: false, status: 400, error: "note must be text of at most 1000 characters." };
  }
  const cleanNote = typeof note === "string" && note.trim() ? note.trim() : null;

  if (action === "reject") {
    const outcome = await deps.reject(application_id, cleanNote);
    if (!outcome.ok) return { ok: false, status: 409, error: "Application not found or already reviewed." };
    return { ok: true, status: "rejected" };
  }

  const application = await deps.getApplication(application_id);
  if (!application) return { ok: false, status: 404, error: "Application not found." };
  if (application.status !== "pending") return { ok: false, status: 409, error: "This application has already been reviewed." };

  // The merchant belongs to the account that applied -- the one whose
  // Tolo-linked phone the application carries. If that account is gone,
  // fall back to the same link-or-create rule tolo-app-login uses
  // (tolo_phone_links, never profiles.phone), so the merchant is still tied
  // to that phone and the applicant can sign in to it from the Tolo app
  // with no password.
  const applicant = await deps.getProfile(application.applicantId);
  let ownerId: string;
  if (applicant) {
    if (applicant.isStaffOrAdmin) {
      return { ok: false, status: 422, error: "The applicant's account is a staff/admin account and can't own a merchant." };
    }
    if (!applicant.active) {
      return { ok: false, status: 422, error: "The applicant's account is suspended." };
    }
    ownerId = applicant.id;
  } else {
    const account = await resolvePhoneAccount(application.applicantPhone, application.businessName, deps);
    if (!account.ok) {
      return { ok: false, status: 422, error: "The applicant's phone belongs to a staff/admin account and can't own a merchant." };
    }
    ownerId = account.userId;
  }

  const outcome = await deps.approve(application.id, ownerId, caller.id, cleanNote);
  if (!outcome.ok) {
    if (outcome.error === "not_found") return { ok: false, status: 404, error: "Application not found." };
    if (outcome.error === "already_reviewed") return { ok: false, status: 409, error: "This application has already been reviewed." };
    return { ok: false, status: 409, error: "The applicant already owns a merchant account." };
  }
  return { ok: true, status: "approved", merchantId: outcome.merchantId, ownerId };
}
