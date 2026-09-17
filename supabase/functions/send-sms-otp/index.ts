// Supabase Auth "Send SMS" hook target. Supabase calls this endpoint instead
// of a built-in provider (Twilio/MessageBird/Vonage) whenever it needs to
// deliver an OTP — used here because Africa's Talking, which actually covers
// Ethiopia, isn't one of the built-in options. Configured under
// Authentication → Hooks → "Send SMS hook" (set via the Management API to
// this function's URL, signed with SEND_SMS_HOOK_SECRET below).
//
// Supabase signs these calls per the Standard Webhooks spec: headers
// webhook-id / webhook-timestamp / webhook-signature, HMAC-SHA256 over
// "{id}.{timestamp}.{raw body}" using the secret's base64 payload (after the
// "v1,whsec_" prefix). We verify that here — an unverified hook would let
// anyone trigger SMS sends (and charges) on our Africa's Talking account.
//
// Hook payload shape (send_sms event): { user: { phone }, sms: { otp } }
import { jsonResponse } from "../_shared/cors.ts";

const AT_USERNAME = Deno.env.get("AFRICASTALKING_USERNAME");
const AT_API_KEY = Deno.env.get("AFRICASTALKING_API_KEY");
const HOOK_SECRET = Deno.env.get("SEND_SMS_HOOK_SECRET");

const MAX_TIMESTAMP_SKEW_SECONDS = 300;

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function verifyWebhookSignature(rawBody: string, headers: Headers, secret: string): Promise<boolean> {
  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signatureHeader = headers.get("webhook-signature");
  if (!id || !timestamp || !signatureHeader) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > MAX_TIMESTAMP_SKEW_SECONDS) return false;

  const secretB64 = secret.replace(/^v1,/, "").replace(/^whsec_/, "");
  const keyBytes = base64ToBytes(secretB64);
  const signedContent = `${id}.${timestamp}.${rawBody}`;

  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sigBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedContent));
  const expectedSig = bytesToBase64(new Uint8Array(sigBuffer));

  return signatureHeader
    .split(" ")
    .map((s) => s.split(",")[1])
    .includes(expectedSig);
}

Deno.serve(async (req) => {
  try {
    if (!AT_USERNAME || !AT_API_KEY || !HOOK_SECRET) {
      return jsonResponse({ error: "SMS provider is not configured" }, 500);
    }

    const rawBody = await req.text();
    const verified = await verifyWebhookSignature(rawBody, req.headers, HOOK_SECRET);
    if (!verified) {
      return jsonResponse({ error: "Invalid webhook signature" }, 401);
    }

    const payload = JSON.parse(rawBody);
    const phone: string | undefined = payload?.user?.phone;
    const otp: string | undefined = payload?.sms?.otp;

    if (!phone || !otp) {
      return jsonResponse({ error: "Missing phone or otp in hook payload" }, 400);
    }

    const message = `Your Tolo verification code is ${otp}`;

    const form = new URLSearchParams({
      username: AT_USERNAME,
      to: phone.startsWith("+") ? phone : `+${phone}`,
      message,
    });

    const res = await fetch("https://api.africastalking.com/version1/messaging", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        apiKey: AT_API_KEY,
      },
      body: form.toString(),
    });

    if (!res.ok) {
      const errText = await res.text();
      return jsonResponse({ error: `Africa's Talking error: ${errText}` }, 502);
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
