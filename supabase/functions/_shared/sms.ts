// SMS sending behind a provider interface, so the app calls sendSms() and never
// a specific vendor. Which provider is used is decided by Edge Function secrets:
//
//   SMS_PROVIDER=mock                      -> MOCK: nothing is sent; every message
//                                             is written to the sms_outbox table
//                                             so you can see what would have gone out.
//   AFRICASTALKING_USERNAME + _API_KEY     -> Africa's Talking (the live provider:
//                                             it actually covers Ethiopia, unlike
//                                             Supabase's built-in SMS providers).
//   neither                                -> not configured; sendSms() reports
//                                             that and callers skip SMS (today's
//                                             behaviour, unchanged).
//
// If SMS_PROVIDER=mock is set it wins over real credentials, so switching to
// live means removing that one secret (see docs/integration/payments-and-sms.md).
//
// Every attempt is logged to sms_outbox (best effort, never fails the caller).
// Messages marked `sensitive` (login codes) are stored as "[redacted]" so an
// admin reading the log can't take over accounts -- except in mock mode with
// SMS_MOCK_REVEAL_OTP=true, which exists so a developer can read the code.

export interface SmsSendResult {
  ok: boolean;
  error?: string;
  messageId?: string;
}

export interface SmsProvider {
  name: string;
  send(phone: string, message: string): Promise<SmsSendResult>;
}

export interface SmsSendOptions {
  /** Notification event ("order_new", "auth_otp", ...), for the log. */
  eventType?: string;
  userId?: string;
  /** Message contains a secret (login code): never store its text in the log. */
  sensitive?: boolean;
}

export interface SmsLogEntry {
  userId: string | null;
  phone: string;
  body: string;
  provider: string;
  status: "sent" | "failed" | "mock";
  error: string | null;
  providerMessageId: string | null;
  eventType: string | null;
}

export interface EnvReader {
  get(key: string): string | undefined;
}

export function toInternationalFormat(phone: string): string {
  return phone.startsWith("+") ? phone : `+${phone}`;
}

export function createMockSmsProvider(): SmsProvider {
  return {
    name: "mock",
    async send() {
      return { ok: true, messageId: `mock_${crypto.randomUUID()}` };
    },
  };
}

export function createAfricasTalkingProvider(username: string, apiKey: string, fetchImpl: typeof fetch = fetch): SmsProvider {
  return {
    name: "africastalking",
    async send(phone, message) {
      const form = new URLSearchParams({ username, to: toInternationalFormat(phone), message });
      const res = await fetchImpl("https://api.africastalking.com/version1/messaging", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", apiKey },
        body: form.toString(),
      });

      if (!res.ok) return { ok: false, error: `Africa's Talking error: ${await res.text()}` };

      // The message id is only for the log; a response shape we don't expect
      // must never turn a successful send into a failure.
      let messageId: string | undefined;
      try {
        messageId = (await res.json())?.SMSMessageData?.Recipients?.[0]?.messageId;
      } catch {
        // ignore
      }
      return { ok: true, messageId };
    },
  };
}

export function resolveSmsProvider(env: EnvReader): SmsProvider | null {
  if (env.get("SMS_PROVIDER") === "mock") return createMockSmsProvider();
  const username = env.get("AFRICASTALKING_USERNAME");
  const apiKey = env.get("AFRICASTALKING_API_KEY");
  if (username && apiKey) return createAfricasTalkingProvider(username, apiKey);
  return null;
}

/** What goes in the log's body column for this message. */
export function bodyForLog(message: string, options: SmsSendOptions, provider: SmsProvider, env: EnvReader): string {
  if (!options.sensitive) return message;
  const revealed = provider.name === "mock" && env.get("SMS_MOCK_REVEAL_OTP") === "true";
  return revealed ? message : "[redacted]";
}

export async function sendSmsWith(
  provider: SmsProvider,
  record: (entry: SmsLogEntry) => Promise<void>,
  env: EnvReader,
  phone: string,
  message: string,
  options: SmsSendOptions = {},
): Promise<SmsSendResult> {
  let result: SmsSendResult;
  try {
    result = await provider.send(phone, message);
  } catch (err) {
    result = { ok: false, error: String(err) };
  }

  try {
    await record({
      userId: options.userId ?? null,
      phone: toInternationalFormat(phone),
      body: bodyForLog(message, options, provider, env),
      provider: provider.name,
      status: !result.ok ? "failed" : provider.name === "mock" ? "mock" : "sent",
      error: result.ok ? null : (result.error ?? "unknown error"),
      providerMessageId: result.messageId ?? null,
      eventType: options.eventType ?? null,
    });
  } catch (err) {
    // A logging problem must never turn into a failed SMS for the caller.
    console.error("Could not write sms_outbox:", err);
  }

  return result;
}

const denoEnv: EnvReader = { get: (key) => Deno.env.get(key) };

export function isSmsConfigured(): boolean {
  return resolveSmsProvider(denoEnv) !== null;
}

export async function sendSms(phone: string, message: string, options: SmsSendOptions = {}): Promise<SmsSendResult> {
  const provider = resolveSmsProvider(denoEnv);
  if (!provider) return { ok: false, error: "SMS provider is not configured" };

  return sendSmsWith(
    provider,
    async (entry) => {
      // Imported lazily so this module (and its unit tests) load without the
      // Supabase client; the client is only needed at the moment of logging.
      const { serviceClient } = await import("./client.ts");
      const { error } = await serviceClient().from("sms_outbox").insert({
        user_id: entry.userId,
        phone: entry.phone,
        body: entry.body,
        provider: entry.provider,
        status: entry.status,
        error: entry.error,
        provider_message_id: entry.providerMessageId,
        event_type: entry.eventType,
      });
      if (error) throw new Error(error.message);
    },
    denoEnv,
    phone,
    message,
    options,
  );
}
