// Types shared by every Tolo-app login flow (tolo-app-login for customers,
// tolo-merchant-login for merchants). Type-only, so pure logic modules can
// import them without pulling in Deno or network code.

export type VerifyResult =
  | { valid: true; phone: string; name: string }
  | { valid: false; reason: "invalid_code" | "expired_code" | "already_used" | "unknown" };

export interface MintedSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}
