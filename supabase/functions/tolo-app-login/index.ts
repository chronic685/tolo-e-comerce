// POST /tolo-app-login
// body: { code: string }
//
// One-login handoff from the Tolo Delivery native app's in-app WebView: the
// app opens /auth/handoff?code=<code>&embed=app on the marketplace site,
// the frontend posts that code here, and this function:
//   1. verifies it server-to-server against the Tolo backend (contract:
//      docs/integration/tolo-app.md);
//   2. matches or creates the marketplace customer by the PHONE THE TOLO
//      BACKEND RETURNED -- never a phone or any other field from this
//      request, which is untrusted -- through tolo_phone_links (migration
//      0072), which only this flow writes; never through the self-editable
//      profiles.phone;
//   3. mints a real Supabase session for that customer.
//
// Code redemption, the IP rate limit and session minting live in
// _shared/tolo_login.ts, shared with tolo-merchant-login.
import { serviceClient } from "../_shared/client.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { phoneAccountStore } from "../_shared/phone_account_store.ts";
import { mintSession, rateLimitByIp, verifyToloCode } from "../_shared/tolo_login.ts";
import { handleAppLogin, type AppLoginDeps } from "./logic.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { code } = await req.json();
    if (!code || typeof code !== "string") {
      return jsonResponse({ error: "code is required." }, 400);
    }

    const db = serviceClient();

    const limited = await rateLimitByIp(db, req, "app_login");
    if (limited) return limited;

    const deps: AppLoginDeps = {
      verifyCode: (c) => verifyToloCode(c, "tolo-app-login"),
      ...phoneAccountStore(db),
      mintSession: (userId) => mintSession(db, userId),
    };

    const result = await handleAppLogin(code, deps);
    if (!result.ok) {
      return jsonResponse({ error: result.error }, result.status);
    }
    return jsonResponse({ session: result.session });
  } catch (err) {
    // Never let a raw error message escape this endpoint -- every failure
    // here is meant to look identical from the outside. Never log `code`,
    // phone numbers, or any token here or anywhere above.
    console.error("tolo-app-login failed:", err instanceof Error ? err.message : String(err));
    return jsonResponse({ error: "Sign-in failed." }, 500);
  }
});
