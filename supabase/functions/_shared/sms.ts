// Thin wrapper around the Africa's Talking messaging API — the same
// provider/account send-sms-otp already uses for auth OTPs (chosen there
// because Africa's Talking actually covers Ethiopia, unlike Supabase's
// built-in SMS providers). Extracted here so any Edge Function that needs
// to send a real SMS (send-sms-otp, and now _shared/notify.ts for
// transactional order/payment SMS) shares one integration instead of each
// standing up its own call to the same API.
const AT_USERNAME = Deno.env.get("AFRICASTALKING_USERNAME");
const AT_API_KEY = Deno.env.get("AFRICASTALKING_API_KEY");

export function isSmsConfigured(): boolean {
  return Boolean(AT_USERNAME && AT_API_KEY);
}

export async function sendSms(phone: string, message: string): Promise<{ ok: boolean; error?: string }> {
  if (!AT_USERNAME || !AT_API_KEY) {
    return { ok: false, error: "SMS provider is not configured" };
  }

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
    return { ok: false, error: `Africa's Talking error: ${await res.text()}` };
  }
  return { ok: true };
}
