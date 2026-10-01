// I/O shared by every Tolo-app login flow (tolo-app-login for customers,
// tolo-merchant-login for merchants): redeeming a one-time code with the
// Tolo backend, rate-limiting by source IP, and minting a session.
import type { serviceClient } from "./client.ts";
import { jsonResponse } from "./cors.ts";
import type { MintedSession, VerifyResult } from "./tolo_login_types.ts";

const TOLO_BACKEND_URL = Deno.env.get("TOLO_BACKEND_URL");
const TOLO_BACKEND_SHARED_KEY = Deno.env.get("TOLO_BACKEND_SHARED_KEY");

const KNOWN_REASONS = ["invalid_code", "expired_code", "already_used"] as const;

// Redeems a one-time code against the Tolo backend's verify-code endpoint
// (contract: docs/integration/tolo-app.md). Never logs the code itself.
export async function verifyToloCode(code: string, logPrefix: string): Promise<VerifyResult> {
  if (!TOLO_BACKEND_URL || !TOLO_BACKEND_SHARED_KEY) {
    console.error(`${logPrefix}: TOLO_BACKEND_URL/TOLO_BACKEND_SHARED_KEY is not configured`);
    return { valid: false, reason: "unknown" };
  }
  try {
    const res = await fetch(`${TOLO_BACKEND_URL}/integrations/tolo-marketplace/verify-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOLO_BACKEND_SHARED_KEY}` },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) {
      console.error(`${logPrefix}: verify-code responded with status`, res.status);
      return { valid: false, reason: "unknown" };
    }
    const body = await res.json();
    if (body?.valid === true && typeof body.phone === "string" && typeof body.name === "string") {
      return { valid: true, phone: body.phone, name: body.name };
    }
    const reason = KNOWN_REASONS.includes(body?.reason) ? body.reason : "unknown";
    return { valid: false, reason };
  } catch (err) {
    console.error(`${logPrefix}: verify-code request failed:`, err instanceof Error ? err.message : String(err));
    return { valid: false, reason: "unknown" };
  }
}

// No caller identity exists yet at a login endpoint, so this rate-limits
// by source IP instead of by user id (same check_and_record_rate_limit()/
// get_rate_limit_config() pair checkout/index.ts uses, just keyed
// differently) -- call it before the Tolo backend call, the expensive step.
// Returns a 429 response to send, or null to continue.
export async function rateLimitByIp(db: ReturnType<typeof serviceClient>, req: Request, action: string): Promise<Response | null> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("cf-connecting-ip") || "unknown";
  const { data: rateLimitConfig } = await db.rpc("get_rate_limit_config", { p_action: action }).single();
  const { data: rateLimit } = await db
    .rpc("check_and_record_rate_limit", {
      p_key: `ip:${ip}:${action}`,
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
  return null;
}

// Session minting has no other prior art in this codebase. This uses
// Supabase's documented recipe for signing a user in from server code:
// admin.generateLink() returns a token_hash without sending anything
// anywhere, which we redeem ourselves via auth.verifyOtp() to get a real
// access+refresh token pair.
export async function mintSession(db: ReturnType<typeof serviceClient>, userId: string): Promise<MintedSession> {
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
}
