// Provider abstraction so new payment providers can be added without
// touching the webhook handler's order/wallet logic. Each provider must
// verify the callback server-side (signature/reference check against the
// provider's API) — never trust the client-supplied "success" flag alone.

export interface PaymentVerificationResult {
  verified: boolean;
  providerReference: string | null;
  rawResponse: unknown;
}

export interface PaymentProvider {
  verify(payload: unknown, headers: Headers): Promise<PaymentVerificationResult>;
}

// TODO: implement real verification per provider (e.g. call the provider's
// transaction-status API with the reference, or check an HMAC signature).
const stubProvider: PaymentProvider = {
  async verify(payload) {
    const p = payload as Record<string, unknown>;
    return {
      verified: p?.status === "success",
      providerReference: (p?.reference as string) ?? null,
      rawResponse: payload,
    };
  },
};

const providers: Record<string, PaymentProvider> = {
  default: stubProvider,
};

export function getPaymentProvider(name: string): PaymentProvider {
  return providers[name] ?? providers.default;
}
