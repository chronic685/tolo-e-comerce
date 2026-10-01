import { describe, expect, it } from "vitest";
import { hmacSha256Hex } from "./hmac.ts";
import {
  GATEWAY_PROVIDER_NAMES,
  MOCK_SIGNATURE_HEADER,
  buildMockCallback,
  createMockGatewayProvider,
  getMockGatewaySecret,
  isGatewayProviderName,
  resolvePaymentProviders,
} from "./payment_providers.ts";

const SECRET = "test-mock-secret";
const env = (values: Record<string, string>) => ({ get: (key: string) => values[key] });

const baseCallback = { payment_id: "pay-1", reference: "mock_chapa_abc", amount: 250, currency: "ETB", status: "success" as const };

describe("gateway registry", () => {
  it("registers nothing by default, so every gateway method is refused", () => {
    expect(resolvePaymentProviders(env({}))).toEqual({});
  });

  it("registers nothing if only the secret is set, without mock mode being switched on", () => {
    expect(resolvePaymentProviders(env({ MOCK_GATEWAY_SECRET: SECRET }))).toEqual({});
  });

  it("registers nothing in mock mode without a secret (a mock that can't sign must not exist)", () => {
    expect(resolvePaymentProviders(env({ PAYMENT_GATEWAY_MODE: "mock" }))).toEqual({});
    expect(resolvePaymentProviders(env({ PAYMENT_GATEWAY_MODE: "mock", MOCK_GATEWAY_SECRET: "" }))).toEqual({});
  });

  it("registers nothing for any mode other than exactly 'mock'", () => {
    expect(resolvePaymentProviders(env({ PAYMENT_GATEWAY_MODE: "live", MOCK_GATEWAY_SECRET: SECRET }))).toEqual({});
  });

  it("registers a mock for every gateway method when mock mode is on", () => {
    const providers = resolvePaymentProviders(env({ PAYMENT_GATEWAY_MODE: "mock", MOCK_GATEWAY_SECRET: SECRET }));
    expect(Object.keys(providers).sort()).toEqual([...GATEWAY_PROVIDER_NAMES].sort());
  });

  it("never registers a manual method (cash, bank transfer, mobile money)", () => {
    const providers = resolvePaymentProviders(env({ PAYMENT_GATEWAY_MODE: "mock", MOCK_GATEWAY_SECRET: SECRET }));
    for (const manual of ["cash_on_delivery", "bank_transfer", "mobile_money"]) expect(providers[manual]).toBeUndefined();
  });

  it("exposes the mock secret only when mock mode is on", () => {
    expect(getMockGatewaySecret(env({ MOCK_GATEWAY_SECRET: SECRET }))).toBeNull();
    expect(getMockGatewaySecret(env({ PAYMENT_GATEWAY_MODE: "mock", MOCK_GATEWAY_SECRET: SECRET }))).toBe(SECRET);
  });

  it("tells gateway methods from manual ones", () => {
    expect(isGatewayProviderName("chapa")).toBe(true);
    expect(isGatewayProviderName("telebirr")).toBe(true);
    expect(isGatewayProviderName("cash_on_delivery")).toBe(false);
    expect(isGatewayProviderName("mobile_money")).toBe(false);
  });
});

describe("mock gateway: initiate", () => {
  const provider = createMockGatewayProvider("chapa", SECRET);
  const input = {
    paymentId: "pay-1",
    orderId: "order-1",
    amount: 250,
    currency: "ETB",
    customer: { name: "Abebe", phone: "+251911223344", email: null },
    appUrl: "https://shop.example.com",
  };

  it("sends the customer to the hosted mock page for this payment", async () => {
    const result = await provider.initiate(input);
    expect(result.checkoutUrl).toBe("https://shop.example.com/mock-gateway/pay-1");
    expect(result.providerReference).toMatch(/^mock_chapa_/);
  });

  it("gives every attempt its own reference", async () => {
    const a = await provider.initiate(input);
    const b = await provider.initiate(input);
    expect(a.providerReference).not.toBe(b.providerReference);
  });

  it("fails clearly when the customer-app URL isn't configured", async () => {
    await expect(provider.initiate({ ...input, appUrl: null })).rejects.toThrow(/CUSTOMER_APP_URL/);
  });
});

describe("mock gateway: verify", () => {
  const provider = createMockGatewayProvider("chapa", SECRET);

  it("accepts a correctly signed success callback", async () => {
    const { rawBody, headers } = await buildMockCallback(SECRET, baseCallback);
    expect(await provider.verify(rawBody, headers)).toMatchObject({
      outcome: "success",
      providerReference: "mock_chapa_abc",
      amount: 250,
      currency: "ETB",
    });
  });

  it("reports an explicit failure as failed", async () => {
    const { rawBody, headers } = await buildMockCallback(SECRET, { ...baseCallback, status: "failed" });
    expect((await provider.verify(rawBody, headers)).outcome).toBe("failed");
  });

  it("treats an unrecognised status as still pending, not as success or failure", async () => {
    const rawBody = JSON.stringify({ ...baseCallback, status: "processing" });
    const headers = new Headers({ [MOCK_SIGNATURE_HEADER]: await hmacSha256Hex(SECRET, rawBody) });
    expect((await provider.verify(rawBody, headers)).outcome).toBe("pending");
  });

  it("rejects a callback with no signature", async () => {
    const { rawBody } = await buildMockCallback(SECRET, baseCallback);
    expect((await provider.verify(rawBody, new Headers())).outcome).toBe("invalid");
  });

  it("rejects a callback signed with the wrong secret", async () => {
    const { rawBody, headers } = await buildMockCallback("someone-elses-secret", baseCallback);
    expect((await provider.verify(rawBody, headers)).outcome).toBe("invalid");
  });

  it("rejects a callback whose body was changed after signing (e.g. a smaller amount)", async () => {
    const { rawBody, headers } = await buildMockCallback(SECRET, baseCallback);
    const tampered = rawBody.replace('"amount":250', '"amount":1');
    expect(tampered).not.toBe(rawBody);
    expect((await provider.verify(tampered, headers)).outcome).toBe("invalid");
  });

  it("rejects a validly signed body that isn't JSON", async () => {
    const rawBody = "not json";
    const headers = new Headers({ [MOCK_SIGNATURE_HEADER]: await hmacSha256Hex(SECRET, rawBody) });
    expect((await provider.verify(rawBody, headers)).outcome).toBe("invalid");
  });

  it("reports a missing or non-numeric amount as null rather than guessing", async () => {
    const rawBody = JSON.stringify({ ...baseCallback, amount: "250" });
    const headers = new Headers({ [MOCK_SIGNATURE_HEADER]: await hmacSha256Hex(SECRET, rawBody) });
    expect((await provider.verify(rawBody, headers)).amount).toBeNull();
  });
});
