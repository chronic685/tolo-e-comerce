// POST /review-merchant-application
// body: { application_id, action: "approve" | "reject", note? }
//
// Admin-tier review of a merchant application (migrations 0072/0074).
// Approval creates the real merchant account tied to the applicant's
// verified phone; it lives here rather than in SQL alone because the
// fallback account creation (shared with tolo-app-login) needs the Auth
// Admin API. Rejection goes through the caller's own session so RLS and
// the review guard trigger apply and stamp the reviewer as usual.
import { serviceClient, userClient } from "../_shared/client.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { phoneAccountStore } from "../_shared/phone_account_store.ts";
import { handleReview, type ReviewDeps } from "./logic.ts";

const APPROVE_ERRORS = ["not_found", "already_reviewed", "already_merchant"] as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authed = userClient(req);
    const db = serviceClient();
    const body = await req.json().catch(() => null);

    const deps: ReviewDeps = {
      ...phoneAccountStore(db),

      async getCaller() {
        const { data: userData, error } = await authed.auth.getUser();
        if (error || !userData?.user) return null;
        const { data: profile } = await db
          .from("profiles")
          .select("admin_tier, account_status")
          .eq("id", userData.user.id)
          .maybeSingle();
        return { id: userData.user.id, isAdminTier: !!profile?.admin_tier && profile.account_status === "active" };
      },

      async getApplication(id) {
        const { data } = await db
          .from("merchant_applications")
          .select("id, status, applicant_id, applicant_phone, business_name")
          .eq("id", id)
          .maybeSingle();
        if (!data) return null;
        return {
          id: data.id,
          status: data.status,
          applicantId: data.applicant_id,
          applicantPhone: data.applicant_phone,
          businessName: data.business_name,
        };
      },

      async getProfile(id) {
        const { data } = await db.from("profiles").select("id, role, admin_tier, account_status").eq("id", id).maybeSingle();
        if (!data) return null;
        return {
          id: data.id,
          isStaffOrAdmin: data.admin_tier != null || String(data.role).startsWith("tolo_"),
          active: data.account_status === "active",
        };
      },

      async approve(applicationId, ownerId, reviewerId, note) {
        const { data, error } = await db.rpc("approve_merchant_application", {
          p_application_id: applicationId,
          p_owner_id: ownerId,
          p_reviewer_id: reviewerId,
          p_note: note,
        });
        if (error) {
          const known = APPROVE_ERRORS.find((e) => e === error.message);
          if (known) return { ok: false, error: known };
          throw new Error(`approve_merchant_application failed: ${error.message}`);
        }
        return { ok: true, merchantId: data as string };
      },

      async reject(applicationId, note) {
        const { data, error } = await authed
          .from("merchant_applications")
          .update({ status: "rejected", admin_note: note })
          .eq("id", applicationId)
          .eq("status", "pending")
          .select("id");
        if (error) throw new Error(`reject failed: ${error.message}`);
        return data && data.length > 0 ? { ok: true } : { ok: false, error: "not_found_or_reviewed" };
      },
    };

    const result = await handleReview(body, deps);
    if (!result.ok) return jsonResponse({ error: result.error }, result.status);
    return jsonResponse(result.status === "approved" ? { status: "approved", merchant_id: result.merchantId } : { status: "rejected" });
  } catch (err) {
    // Never log phone numbers or tokens.
    console.error("review-merchant-application failed:", err instanceof Error ? err.message : String(err));
    return jsonResponse({ error: "Review failed." }, 500);
  }
});
