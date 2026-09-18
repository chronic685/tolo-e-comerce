// Provider abstraction (External Integrations spec, sections 5/13/40): the
// app calls PaymentService, never a specific gateway, so a real gateway can
// be dropped in later without touching payment-webhook or checkout.
//
// No real gateway (Chapa/Telebirr/bank API) is connected yet — Tolo's three
// configured methods (cash on delivery, bank transfer, mobile money) are all
// manually reconciled by a human today, so none of them has a webhook-based
// adapter here. Manual confirmation goes through confirm-payment instead,
// which is authenticated and role-checked, unlike this public webhook path.
// Registering a provider name below is what "connects" it to the automated
// payment-webhook flow — until then, payment-webhook refuses to confirm it.

export interface PaymentVerificationResult {
  verified: boolean;
  providerReference: string | null;
  rawResponse: unknown;
}

export interface PaymentProvider {
  verify(payload: unknown, headers: Headers): Promise<PaymentVerificationResult>;
}

const providers: Record<string, PaymentProvider> = {
  // Example once a real gateway is connected:
  // chapa: chapaProvider,
};

export function getPaymentProvider(name: string): PaymentProvider | undefined {
  return providers[name];
}
