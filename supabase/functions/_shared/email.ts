// Thin wrapper around the Resend API for transactional email — same role
// _shared/sms.ts plays for Africa's Talking. Free tier (100/day, no business
// verification). Without a verified sending domain in the Resend dashboard,
// Resend's sandbox restriction means mail can only actually be delivered to
// the account owner's own registered email address, sent from the shared
// onboarding@resend.dev address; once a domain is verified there,
// RESEND_FROM_ADDRESS can be set to a real address and that restriction
// goes away — nothing here needs to change for that.
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_ADDRESS = Deno.env.get("RESEND_FROM_ADDRESS") ?? "Tolo <onboarding@resend.dev>";

export function isEmailConfigured(): boolean {
  return Boolean(RESEND_API_KEY);
}

export async function sendEmail(to: string, subject: string, text: string): Promise<{ ok: boolean; error?: string }> {
  if (!RESEND_API_KEY) {
    return { ok: false, error: "Email provider is not configured" };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM_ADDRESS, to, subject, text }),
  });

  if (!res.ok) {
    return { ok: false, error: `Resend error: ${await res.text()}` };
  }
  return { ok: true };
}
