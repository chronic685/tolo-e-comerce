// What to do with a payment-gateway callback, shared by payment-webhook (the
// real path) and mock-gateway (which sends a correctly signed callback to the
// same code). Everything here is I/O-free or injected so it can be unit tested.
//
// Three protections the old inline webhook code did not have, all of which
// matter the moment a real gateway is connected:
//  1. A callback that fails signature verification changes NOTHING. Before,
//     any unverified callback marked the payment failed, so anyone who knew a
//     payment id could fail someone else's payment and trigger their
//     "payment failed" notification.
//  2. A "success" only counts if the amount the gateway collected matches the
//     amount we asked for (stops a 1 ETB payment settling a 1000 ETB order).
//  3. Moving a payment to verified/failed is one atomic claim, so a gateway
//     that delivers the same webhook twice at the same moment can't release
//     stock or credit the merchant wallet twice.
import type { PaymentVerificationResult } from "./payment_providers.ts";

export interface CallbackPayment {
  id: string;
  status: string;
  amount: number;
  currency: string;
}

export type CallbackDecision =
  | { action: "reject_invalid" }
  | { action: "already_processed" }
  | { action: "ignore"; reason: string }
  | { action: "record_only"; reason: "pending" | "amount_unverified" | "amount_mismatch" | "currency_mismatch" }
  | { action: "finalize_success" }
  | { action: "finalize_failure" };

// Amounts are numeric(12,2); this only absorbs float noise, not real differences.
const AMOUNT_TOLERANCE = 0.005;

export function decideCallbackAction(payment: CallbackPayment, result: PaymentVerificationResult): CallbackDecision {
  if (result.outcome === "invalid") return { action: "reject_invalid" };

  if (payment.status === "verified") return { action: "already_processed" };
  // Money already went back to the customer: a late callback must not undo that.
  if (payment.status === "refunded") return { action: "ignore", reason: "payment already refunded" };

  if (result.outcome === "pending") return { action: "record_only", reason: "pending" };

  if (result.outcome === "failed") {
    return payment.status === "failed" ? { action: "already_processed" } : { action: "finalize_failure" };
  }

  // outcome === "success". A success arriving for a payment we had marked
  // failed is accepted on purpose: if the gateway really collected the money,
  // the order must not stay unpaid just because an earlier attempt failed.
  if (result.amount === null) return { action: "record_only", reason: "amount_unverified" };
  if (Math.abs(result.amount - payment.amount) > AMOUNT_TOLERANCE) return { action: "record_only", reason: "amount_mismatch" };
  if (result.currency !== null && result.currency.toUpperCase() !== payment.currency.toUpperCase()) {
    return { action: "record_only", reason: "currency_mismatch" };
  }
  return { action: "finalize_success" };
}

export interface CallbackStore {
  /** Append to the payment_transactions audit trail. */
  recordTransaction(row: {
    providerReference: string | null;
    status: "pending" | "verified" | "failed";
    rawResponse: unknown;
    verifiedAt: string | null;
  }): Promise<void>;
  /** Atomically move the payment to `to` if it is currently in one of `from`. True only for the caller that won. */
  claimPayment(from: string[], to: "verified" | "failed"): Promise<boolean>;
  /** Side effects: stock release, merchant wallet credit, notifications. */
  finalizeSuccess(): Promise<void>;
  finalizeFailure(): Promise<void>;
}

export interface CallbackResponse {
  status: number;
  body: Record<string, unknown>;
}

const RECORD_ONLY_MESSAGES = {
  amount_unverified: "The gateway did not report the amount collected, so the payment was not confirmed.",
  amount_mismatch: "The amount collected does not match the amount due, so the payment was not confirmed.",
  currency_mismatch: "The currency collected does not match the order currency, so the payment was not confirmed.",
} as const;

export async function handleGatewayCallback(
  payment: CallbackPayment,
  result: PaymentVerificationResult,
  store: CallbackStore,
  now: () => Date = () => new Date(),
): Promise<CallbackResponse> {
  const decision = decideCallbackAction(payment, result);

  if (decision.action === "reject_invalid") {
    // Nothing is recorded or changed: an unauthenticated caller must not be
    // able to write to the audit trail or touch payment state.
    return { status: 401, body: { error: "Invalid gateway signature" } };
  }

  if (decision.action === "already_processed") return { status: 200, body: { ok: true, already_processed: true } };
  if (decision.action === "ignore") return { status: 200, body: { ok: true, ignored: true, reason: decision.reason } };

  if (decision.action === "record_only") {
    await store.recordTransaction({
      providerReference: result.providerReference,
      status: "pending",
      rawResponse: { ...(result.rawResponse as object | null), tolo_note: decision.reason },
      verifiedAt: null,
    });
    if (decision.reason === "pending") return { status: 200, body: { ok: true, pending: true } };
    return { status: 400, body: { error: RECORD_ONLY_MESSAGES[decision.reason] } };
  }

  if (decision.action === "finalize_failure") {
    await store.recordTransaction({ providerReference: result.providerReference, status: "failed", rawResponse: result.rawResponse, verifiedAt: null });
    if (await store.claimPayment(["pending"], "failed")) await store.finalizeFailure();
    return { status: 200, body: { ok: false } };
  }

  await store.recordTransaction({
    providerReference: result.providerReference,
    status: "verified",
    rawResponse: result.rawResponse,
    verifiedAt: now().toISOString(),
  });
  if (!(await store.claimPayment(["pending", "failed"], "verified"))) {
    return { status: 200, body: { ok: true, already_processed: true } };
  }
  await store.finalizeSuccess();
  return { status: 200, body: { ok: true } };
}
