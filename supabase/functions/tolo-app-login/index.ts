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
// Session-minting has no prior art in this codebase (no Edge Function here
// creates a session server-side today). This uses Supabase's documented
// recipe for signing a user in from server code: admin.generateLink()
// returns a token_hash without sending anything anywhere, which we redeem
// ourselves via auth.verifyOtp() to get a real access+refresh token pair --
// see mintSession below.
import { serviceClient } from "../_shared/client.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { phoneAccountStore } from "../_shared/phone_account_store.ts";
import { handleAppLogin, type AppLoginDeps, type VerifyResult } from "./logic.ts";

const TOLO_BACKEND_URL = Deno.env.get("TOLO_BACKEND_URL");
const TOLO_BACKEND_SHARED_KEY = Deno.env.get("TOLO_BACKEND_SHARED_KEY");

const KNOWN_REASONS = ["invalid_code", "expired_code", "already_used"] as const;

async function verifyCode(code: string): Promise<VerifyResult> {
  if (!TOLO_BACKEND_URL || !TOLO_BACKEND_SHARED_KEY) {
    console.error("tolo-app-login: TOLO_BACKEND_URL/TOLO_BACKEND_SHARED_KEY is not configured");
    return { valid: false, reason: "unknown" };
  }
  try {
    const res = await fetch(`${TOLO_BACKEND_URL}/integrations/tolo-marketplace/verify-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOLO_BACKEND_SHARED_KEY}` },
      // Never log `code` itself -- only the outcome, below.
      body: JSON.stringify({ code }),
    });
    if (!res.ok) {
      console.error("tolo-app-login: verify-code responded with status", res.status);
      return { valid: false, reason: "unknown" };
    }
    const body = await res.json();
    if (body?.valid === true && typeof body.phone === "string" && typeof body.name === "string") {
      return { valid: true, phone: body.phone, name: body.name };
    }
    const reason = KNOWN_REASONS.includes(body?.reason) ? body.reason : "unknown";
    return { valid: false, reason };
  } catch (err) {
    console.error("tolo-app-login: verify-code request failed:", err instanceof Error ? err.message : String(err));
    return { valid: false, reason: "unknown" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { code } = await req.json();
    if (!code || typeof code !== "string") {
      return jsonResponse({ error: "code is required." }, 400);
    }

    const db = serviceClient();

    // No caller identity exists yet at this endpoint, so this rate-limits
    // by source IP instead of by customer id (same
    // check_and_record_rate_limit()/get_rate_limit_config() pair
    // checkout/index.ts uses, just keyed differently) -- done before the
    // Tolo backend call, the expensive step, same ordering principle.
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("cf-connecting-ip") || "unknown";
    const { data: rateLimitConfig } = await db.rpc("get_rate_limit_config", { p_action: "app_login" }).single();
    const { data: rateLimit } = await db
      .rpc("check_and_record_rate_limit", {
        p_key: `ip:${ip}:app_login`,
        p_max_count: rateLimitConfig?.max_count ?? 10,
        p_window_seconds: rateLimitConfig?.window_seconds ?? 600,
      })
      .single();
    if (rateLimit && !rateLimit.allowed) {
      return jsonResponse(
        { error: "too_many_requests", message: "Too many requests. Please try again shortly." },
        429,
        rateLimit.retry_after_seconds ? { "Retry-After": String(rateLimit.retry_after_seconds) } : undefined,
      );
    }

    const deps: AppLoginDeps = {
      verifyCode,

      ...phoneAccountStore(db),

      async mintSession(userId) {
        const { data: userRes, error: userError } = await db.auth.admin.getUserById(userId);
        if (userError || !userRes?.user?.email) {
          throw new Error("Could not sign in.");
        }
        const { data: linkData, error: linkError } = await db.auth.admin.generateLink({
          type: "magiclink",
          email: userRes.user.email,
        });
        if (linkError || !linkData?.properties?.hashed_token) {
          throw new Error("Could not sign in.");
        }
        const { data: verifyData, error: verifyError } = await db.auth.verifyOtp({
          type: "magiclink",
          token_hash: linkData.properties.hashed_token,
        });
        if (verifyError || !verifyData?.session) {
          throw new Error("Could not sign in.");
        }
        const s = verifyData.session;
        return { access_token: s.access_token, refresh_token: s.refresh_token, expires_in: s.expires_in, token_type: s.token_type };
      },
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
