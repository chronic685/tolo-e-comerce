// Provider abstraction (External Integrations spec, sections 5/13/40): the
// app calls PaymentProvider, never a specific gateway, so a real gateway can
// be dropped in later without touching payment-webhook, checkout or the UI.
//
// Two kinds of payment method exist in Tolo:
//  - Manual ones (cash on delivery, bank transfer, mobile money): a human
//    confirms the money moved via confirm-payment. They have no entry here.
//  - Online gateways (Chapa, Telebirr): checkout calls initiate() to get a
//    hosted-checkout URL, the customer pays on the gateway's page, and the
//    gateway then calls payment-webhook, where verify() decides what really
//    happened. Registering a provider below is what turns a gateway on.
//
// No real gateway is connected yet. Until one is, the only thing that can be
// registered is the signed MOCK gateway, and only when PAYMENT_GATEWAY_MODE=mock
// and MOCK_GATEWAY_SECRET are both set as Edge Function secrets. With neither
// set (the default, and what production should run today) the registry is
// empty and every gateway method is refused at checkout.
import { hmacSha256Hex, timingSafeEqual } from "./hmac.ts";

/** Payment methods that need an online gateway (everything else is manual). */
export const GATEWAY_PROVIDER_NAMES = ["chapa", "telebirr"] as const;

export function isGatewayProviderName(name: string): boolean {
  return (GATEWAY_PROVIDER_NAMES as readonly string[]).includes(name);
}

// What a callback turned out to mean:
//  success - authentic, and the gateway says the money was collected
//  failed  - authentic, and the gateway says the payment definitively failed
//  pending - authentic, but not finished yet (nothing to do but log it)
//  invalid - not authentic (bad or missing signature, unreadable body): ignore
export type GatewayOutcome = "success" | "failed" | "pending" | "invalid";

export interface PaymentVerificationResult {
  outcome: GatewayOutcome;
  providerReference: string | null;
  /** Amount the gateway says it collected, in ETB. null if the gateway didn't say. */
  amount: number | null;
  currency: string | null;
  rawResponse: unknown;
}

export interface InitiatePaymentInput {
  paymentId: string;
  orderId: string;
  /** Amount to collect, taken from our own database, never from the client. */
  amount: number;
  currency: string;
  customer: { name: string | null; phone: string | null; email: string | null };
  /** Customer-app base URL without a trailing slash (CUSTOMER_APP_URL), if configured. */
  appUrl: string | null;
}

export interface InitiatePaymentResult {
  /** Where to send the customer to pay. */
  checkoutUrl: string;
  /** The gateway's own id for this attempt (Chapa calls it tx_ref). */
  providerReference: string;
}

export interface PaymentProvider {
  initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult>;
  /**
   * Decide what a callback means. Receives the RAW request body because
   * signatures are computed over the exact bytes. A real adapter should also
   * confirm with the gateway's own verify API here, not just trust the webhook.
   */
  verify(rawBody: string, headers: Headers): Promise<PaymentVerificationResult>;
}

// ---- Mock gateway ---------------------------------------------------------
// Behaves like a real signed gateway so the whole path (initiate, hosted page,
// signed webhook, verification, finalize) is genuinely exercised end to end.

export const MOCK_SIGNATURE_HEADER = "x-mock-signature";

const INVALID_RESULT: PaymentVerificationResult = {
  outcome: "invalid",
  providerReference: null,
  amount: null,
  currency: null,
  rawResponse: null,
};

export function createMockGatewayProvider(name: string, secret: string): PaymentProvider {
  return {
    async initiate(input) {
      if (!input.appUrl) {
        throw new Error("CUSTOMER_APP_URL is not set, so the mock checkout page has nowhere to live.");
      }
      return {
        checkoutUrl: `${input.appUrl}/mock-gateway/${input.paymentId}`,
        providerReference: `mock_${name}_${crypto.randomUUID()}`,
      };
    },

    async verify(rawBody, headers) {
      const signature = headers.get(MOCK_SIGNATURE_HEADER);
      if (!signature) return INVALID_RESULT;
      if (!timingSafeEqual(signature, await hmacSha256Hex(secret, rawBody))) return INVALID_RESULT;

      let payload: { reference?: unknown; amount?: unknown; currency?: unknown; status?: unknown };
      try {
        payload = JSON.parse(rawBody);
      } catch {
        return INVALID_RESULT;
      }

      const outcome: GatewayOutcome = payload.status === "success" ? "success" : payload.status === "failed" ? "failed" : "pending";
      return {
        outcome,
        providerReference: typeof payload.reference === "string" ? payload.reference : null,
        amount: typeof payload.amount === "number" && Number.isFinite(payload.amount) ? payload.amount : null,
        currency: typeof payload.currency === "string" ? payload.currency : null,
        rawResponse: payload,
      };
    },
  };
}

/** Signs a mock callback exactly the way the mock provider expects to verify it. */
export async function buildMockCallback(
  secret: string,
  payload: { payment_id: string; reference: string; amount: number; currency: string; status: "success" | "failed" },
): Promise<{ rawBody: string; headers: Headers }> {
  const rawBody = JSON.stringify(payload);
  const headers = new Headers({ [MOCK_SIGNATURE_HEADER]: await hmacSha256Hex(secret, rawBody) });
  return { rawBody, headers };
}

// ---- Registry -------------------------------------------------------------

export interface EnvReader {
  get(key: string): string | undefined;
}

/** The mock secret, only when mock mode is deliberately switched on. */
export function getMockGatewaySecret(env: EnvReader): string | null {
  return env.get("PAYMENT_GATEWAY_MODE") === "mock" ? env.get("MOCK_GATEWAY_SECRET") || null : null;
}

export function resolvePaymentProviders(env: EnvReader): Record<string, PaymentProvider> {
  const providers: Record<string, PaymentProvider> = {};

  const mockSecret = getMockGatewaySecret(env);
  if (mockSecret) {
    for (const name of GATEWAY_PROVIDER_NAMES) providers[name] = createMockGatewayProvider(name, mockSecret);
  }

  // LIVE GATEWAYS: when Chapa/Telebirr credentials exist, register the real
  // adapters here (they replace the mock for that name), e.g.
  //   const chapaKey = env.get("CHAPA_SECRET_KEY");
  //   if (chapaKey) providers.chapa = createChapaProvider(chapaKey, env.get("CHAPA_WEBHOOK_SECRET"));
  // See docs/integration/payments-and-sms.md for the full activation checklist.

  return providers;
}

const denoEnv: EnvReader = { get: (key) => Deno.env.get(key) };

export function getPaymentProvider(name: string): PaymentProvider | undefined {
  return resolvePaymentProviders(denoEnv)[name];
}

export function getDenoMockGatewaySecret(): string | null {
  return getMockGatewaySecret(denoEnv);
}
