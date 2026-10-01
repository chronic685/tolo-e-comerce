import { describe, expect, it } from "vitest";
import {
  type SmsLogEntry,
  type SmsProvider,
  bodyForLog,
  createAfricasTalkingProvider,
  createMockSmsProvider,
  resolveSmsProvider,
  sendSmsWith,
  toInternationalFormat,
} from "./sms.ts";

const env = (values: Record<string, string> = {}) => ({ get: (key: string) => values[key] });
const AT_ENV = { AFRICASTALKING_USERNAME: "tolo", AFRICASTALKING_API_KEY: "key-123" };

describe("resolveSmsProvider", () => {
  it("is not configured with no secrets, so callers keep skipping SMS exactly as before", () => {
    expect(resolveSmsProvider(env())).toBeNull();
  });

  it("needs both Africa's Talking credentials", () => {
    expect(resolveSmsProvider(env({ AFRICASTALKING_USERNAME: "tolo" }))).toBeNull();
    expect(resolveSmsProvider(env({ AFRICASTALKING_API_KEY: "key" }))).toBeNull();
    expect(resolveSmsProvider(env(AT_ENV))?.name).toBe("africastalking");
  });

  it("uses the mock when asked, even without credentials", () => {
    expect(resolveSmsProvider(env({ SMS_PROVIDER: "mock" }))?.name).toBe("mock");
  });

  it("lets the mock win over real credentials, so a forgotten switch can't spend money", () => {
    expect(resolveSmsProvider(env({ ...AT_ENV, SMS_PROVIDER: "mock" }))?.name).toBe("mock");
  });

  it("ignores any other SMS_PROVIDER value", () => {
    expect(resolveSmsProvider(env({ SMS_PROVIDER: "twilio" }))).toBeNull();
  });
});

describe("toInternationalFormat", () => {
  it("adds the + only when it's missing", () => {
    expect(toInternationalFormat("251911223344")).toBe("+251911223344");
    expect(toInternationalFormat("+251911223344")).toBe("+251911223344");
  });
});

describe("mock provider", () => {
  it("never sends anything and always reports success with a mock id", async () => {
    const result = await createMockSmsProvider().send("+251911223344", "hi");
    expect(result.ok).toBe(true);
    expect(result.messageId).toMatch(/^mock_/);
  });
});

describe("Africa's Talking provider", () => {
  it("posts the message in Africa's Talking's expected format and reports the message id", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ SMSMessageData: { Recipients: [{ messageId: "ATXid_1" }] } }), { status: 201 });
    }) as unknown as typeof fetch;

    const result = await createAfricasTalkingProvider("tolo", "key-123", fetchImpl).send("251911223344", "Your order is ready");

    expect(result).toEqual({ ok: true, messageId: "ATXid_1" });
    expect(seen!.url).toBe("https://api.africastalking.com/version1/messaging");
    expect((seen!.init.headers as Record<string, string>).apiKey).toBe("key-123");
    const form = new URLSearchParams(seen!.init.body as string);
    expect(form.get("username")).toBe("tolo");
    expect(form.get("to")).toBe("+251911223344");
    expect(form.get("message")).toBe("Your order is ready");
  });

  it("reports a rejected request as a failure with the provider's error", async () => {
    const fetchImpl = (async () => new Response("invalid api key", { status: 401 })) as unknown as typeof fetch;
    const result = await createAfricasTalkingProvider("tolo", "bad", fetchImpl).send("+251911223344", "hi");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("invalid api key");
  });

  it("still counts a send as successful when the response body isn't the JSON we expected", async () => {
    const fetchImpl = (async () => new Response("OK", { status: 200 })) as unknown as typeof fetch;
    const result = await createAfricasTalkingProvider("tolo", "key", fetchImpl).send("+251911223344", "hi");
    expect(result.ok).toBe(true);
    expect(result.messageId).toBeUndefined();
  });
});

describe("bodyForLog", () => {
  const mock = createMockSmsProvider();
  const live: SmsProvider = { name: "africastalking", send: async () => ({ ok: true }) };

  it("keeps ordinary messages as they are", () => {
    expect(bodyForLog("Order ready", {}, live, env())).toBe("Order ready");
  });

  it("redacts a sensitive message (login code) by default", () => {
    expect(bodyForLog("Your code is 123456", { sensitive: true }, mock, env())).toBe("[redacted]");
    expect(bodyForLog("Your code is 123456", { sensitive: true }, live, env())).toBe("[redacted]");
  });

  it("reveals a sensitive message only for the mock provider with the explicit opt-in", () => {
    expect(bodyForLog("code 123456", { sensitive: true }, mock, env({ SMS_MOCK_REVEAL_OTP: "true" }))).toBe("code 123456");
  });

  it("never reveals a real provider's login codes, whatever the flag says", () => {
    expect(bodyForLog("code 123456", { sensitive: true }, live, env({ SMS_MOCK_REVEAL_OTP: "true" }))).toBe("[redacted]");
  });
});

describe("sendSmsWith", () => {
  function recorder() {
    const entries: SmsLogEntry[] = [];
    return { entries, record: async (entry: SmsLogEntry) => void entries.push(entry) };
  }

  it("logs a mock send with status 'mock'", async () => {
    const { entries, record } = recorder();
    const result = await sendSmsWith(createMockSmsProvider(), record, env(), "251911223344", "Order ready", { eventType: "order_ready_for_pickup", userId: "u1" });
    expect(result.ok).toBe(true);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      status: "mock",
      provider: "mock",
      phone: "+251911223344",
      body: "Order ready",
      eventType: "order_ready_for_pickup",
      userId: "u1",
      error: null,
    });
  });

  it("logs a live send with status 'sent' and the provider's message id", async () => {
    const { entries, record } = recorder();
    const live: SmsProvider = { name: "africastalking", send: async () => ({ ok: true, messageId: "AT1" }) };
    await sendSmsWith(live, record, env(), "+251911223344", "hi");
    expect(entries[0]).toMatchObject({ status: "sent", provider: "africastalking", providerMessageId: "AT1" });
  });

  it("logs a refusal as 'failed' with its error and returns it to the caller", async () => {
    const { entries, record } = recorder();
    const failing: SmsProvider = { name: "africastalking", send: async () => ({ ok: false, error: "no credit" }) };
    const result = await sendSmsWith(failing, record, env(), "+251911223344", "hi");
    expect(result).toEqual({ ok: false, error: "no credit" });
    expect(entries[0]).toMatchObject({ status: "failed", error: "no credit" });
  });

  it("turns a provider that throws into a failed result instead of throwing", async () => {
    const { entries, record } = recorder();
    const exploding: SmsProvider = { name: "africastalking", send: async () => { throw new Error("network down"); } };
    const result = await sendSmsWith(exploding, record, env(), "+251911223344", "hi");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("network down");
    expect(entries[0].status).toBe("failed");
  });

  it("never lets a logging failure change the outcome of the send", async () => {
    const result = await sendSmsWith(createMockSmsProvider(), async () => { throw new Error("db down"); }, env(), "+251911223344", "hi");
    expect(result.ok).toBe(true);
  });

  it("stores a login code as [redacted]", async () => {
    const { entries, record } = recorder();
    await sendSmsWith(createMockSmsProvider(), record, env(), "+251911223344", "Your Tolo verification code is 482913", { sensitive: true, eventType: "auth_otp" });
    expect(entries[0].body).toBe("[redacted]");
    expect(JSON.stringify(entries[0])).not.toContain("482913");
  });
});
