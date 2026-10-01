// POST /tolo-merchant-login
// body: { code: string }
//
// Merchant sign-in from the Tolo app's "Merchant" button: the app opens
// /auth/handoff?code=<code>&embed=app on the MERCHANT DASHBOARD, which posts
// that code here. This function:
//   1. verifies the code server-to-server against the Tolo backend (same
//      verify-code contract as tolo-app-login, docs/integration/tolo-app.md);
//   2. resolves the merchant account for the PHONE THE TOLO BACKEND
//      RETURNED, only through tolo_phone_links (never profiles.phone) and
//      only if that phone's latest merchant application was approved
//      (tolo_merchant_account_for_phone, migration 0076);
//   3. mints a real Supabase session for that account -- no password, same
//      as the customer login.
// It never creates an account.
import { serviceClient } from "../_shared/client.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { mintSession, rateLimitByIp, verifyToloCode } from "../_shared/tolo_login.ts";
import { handleMerchantAppLogin, type MerchantLoginDeps } from "./logic.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { code } = await req.json();
    if (!code || typeof code !== "string") {
      return jsonResponse({ error: "code is required." }, 400);
    }

    const db = serviceClient();

    const limited = await rateLimitByIp(db, req, "merchant_app_login");
    if (limited) return limited;

    const deps: MerchantLoginDeps = {
      verifyCode: (c) => verifyToloCode(c, "tolo-merchant-login"),

      async findMerchantAccount(phone) {
        const { data, error } = await db.rpc("tolo_merchant_account_for_phone", { p_phone: phone }).maybeSingle();
        if (error) throw new Error(`tolo_merchant_account_for_phone failed: ${error.message}`);
        return data ? { userId: data.user_id as string, merchantId: data.merchant_id as string } : null;
      },

      async recordLogin(userId) {
        await db.rpc("record_tolo_login", { p_user_id: userId });
      },

      mintSession: (userId) => mintSession(db, userId),
    };

    const result = await handleMerchantAppLogin(code, deps);
    if (!result.ok) {
      return jsonResponse({ error: result.error }, result.status);
    }
    return jsonResponse({ session: result.session });
  } catch (err) {
    // Every failure looks identical from the outside. Never log `code`,
    // phone numbers, or any token.
    console.error("tolo-merchant-login failed:", err instanceof Error ? err.message : String(err));
    return jsonResponse({ error: "Sign-in failed." }, 500);
  }
});
