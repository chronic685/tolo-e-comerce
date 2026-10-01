// HMAC-SHA256 helpers for checking that a payment-gateway callback really came
// from the gateway. Used by the mock gateway today and by real gateway
// adapters later (Chapa and Telebirr both sign their webhooks).
const encoder = new TextEncoder();

export async function hmacSha256Hex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Constant-time comparison so a signature can't be guessed byte-by-byte from
// response timing. The length check leaks only the (public, fixed) length.
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
