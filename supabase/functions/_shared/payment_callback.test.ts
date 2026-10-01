import { describe, expect, it } from "vitest";
import { type CallbackPayment, type CallbackStore, decideCallbackAction, handleGatewayCallback } from "./payment_callback.ts";
import { type PaymentVerificationResult, buildMockCallback, createMockGatewayProvider } from "./payment_providers.ts";

const payment = (overrides: Partial<CallbackPayment> = {}): CallbackPayment => ({
  id: "pay-1",
  status: "pending",
  amount: 250,
  currency: "ETB",
  ...overrides,
});

const result = (overrides: Partial<PaymentVerificationResult> = {}): PaymentVerificationResult => ({
  outcome: "success",
  providerReference: "ref-1",
  amount: 250,
  currency: "ETB",
  rawResponse: { status: "success" },
  ...overrides,
});

function fakeStore(claimResult = true) {
  const calls: string[] = [];
  const recorded: Array<Parameters<CallbackStore["recordTransaction"]>[0]> = [];
  const claims: Array<{ from: string[]; to: string }> = [];
  const store: CallbackStore = {
    async recordTransaction(row) {
      calls.push("record");
      recorded.push(row);
    },
    async claimPayment(from, to) {
      calls.push("claim");
      claims.push({ from, to });
      return claimResult;
    },
    async finalizeSuccess() {
      calls.push("finalizeSuccess");
    },
    async finalizeFailure() {
      calls.push("finalizeFailure");
    },
  };
  return { store, calls, recorded, claims };
}

describe("decideCallbackAction", () => {
  it("rejects an unauthentic callback before looking at anything else", () => {
    expect(decideCallbackAction(payment(), result({ outcome: "invalid" }))).toEqual({ action: "reject_invalid" });
    expect(decideCallbackAction(payment({ status: "verified" }), result({ outcome: "invalid" }))).toEqual({ action: "reject_invalid" });
  });

  it("finalizes a matching success on a pending payment", () => {
    expect(decideCallbackAction(payment(), result())).toEqual({ action: "finalize_success" });
  });

  it("accepts a late success for a payment an earlier attempt had marked failed", () => {
    expect(decideCallbackAction(payment({ status: "failed" }), result())).toEqual({ action: "finalize_success" });
  });

  it("treats a repeat callback for a verified payment as already processed", () => {
    expect(decideCallbackAction(payment({ status: "verified" }), result())).toEqual({ action: "already_processed" });
    expect(decideCallbackAction(payment({ status: "verified" }), result({ outcome: "failed" }))).toEqual({ action: "already_processed" });
  });

  it("never lets a callback undo a refund", () => {
    expect(decideCallbackAction(payment({ status: "refunded" }), result()).action).toBe("ignore");
    expect(decideCallbackAction(payment({ status: "refunded" }), result({ outcome: "failed" })).action).toBe("ignore");
  });

  it("only logs a callback that says the payment is still in progress", () => {
    expect(decideCallbackAction(payment(), result({ outcome: "pending" }))).toEqual({ action: "record_only", reason: "pending" });
  });

  it("fails a pending payment on an authentic failure, but not one that already failed", () => {
    expect(decideCallbackAction(payment(), result({ outcome: "failed" }))).toEqual({ action: "finalize_failure" });
    expect(decideCallbackAction(payment({ status: "failed" }), result({ outcome: "failed" }))).toEqual({ action: "already_processed" });
  });

  it("refuses to confirm when the amount collected differs from the amount due", () => {
    expect(decideCallbackAction(payment({ amount: 1000 }), result({ amount: 1 }))).toEqual({ action: "record_only", reason: "amount_mismatch" });
    expect(decideCallbackAction(payment({ amount: 1000 }), result({ amount: 1500 }))).toEqual({ action: "record_only", reason: "amount_mismatch" });
  });

  it("refuses to confirm when the gateway didn't say how much it collected", () => {
    expect(decideCallbackAction(payment(), result({ amount: null }))).toEqual({ action: "record_only", reason: "amount_unverified" });
  });

  it("ignores float noise in the amount but not a real difference of a cent", () => {
    expect(decideCallbackAction(payment({ amount: 100 }), result({ amount: 100.004 })).action).toBe("finalize_success");
    expect(decideCallbackAction(payment({ amount: 100 }), result({ amount: 100.01 })).action).toBe("record_only");
  });

  it("refuses to confirm when the currency differs, whatever the letter case", () => {
    expect(decideCallbackAction(payment(), result({ currency: "USD" }))).toEqual({ action: "record_only", reason: "currency_mismatch" });
    expect(decideCallbackAction(payment(), result({ currency: "etb" })).action).toBe("finalize_success");
  });
});

describe("handleGatewayCallback", () => {
  const fixedNow = () => new Date("2026-10-01T12:00:00.000Z");

  it("changes and records nothing for an unauthentic callback", async () => {
    const { store, calls } = fakeStore();
    const response = await handleGatewayCallback(payment(), result({ outcome: "invalid" }), store, fixedNow);
    expect(response.status).toBe(401);
    expect(calls).toEqual([]);
  });

  it("confirms a matching success: records it, claims the payment, then runs the side effects once", async () => {
    const { store, calls, recorded, claims } = fakeStore();
    const response = await handleGatewayCallback(payment(), result(), store, fixedNow);
    expect(response).toEqual({ status: 200, body: { ok: true } });
    expect(calls).toEqual(["record", "claim", "finalizeSuccess"]);
    expect(recorded[0]).toMatchObject({ status: "verified", providerReference: "ref-1", verifiedAt: "2026-10-01T12:00:00.000Z" });
    expect(claims[0]).toEqual({ from: ["pending", "failed"], to: "verified" });
  });

  it("runs the side effects only for the delivery that wins the claim (duplicate webhooks)", async () => {
    const { store, calls } = fakeStore(false);
    const response = await handleGatewayCallback(payment(), result(), store, fixedNow);
    expect(response.body).toEqual({ ok: true, already_processed: true });
    expect(calls).not.toContain("finalizeSuccess");
  });

  it("does nothing at all for a replay against an already-verified payment", async () => {
    const { store, calls } = fakeStore();
    const response = await handleGatewayCallback(payment({ status: "verified" }), result(), store, fixedNow);
    expect(response.body).toEqual({ ok: true, already_processed: true });
    expect(calls).toEqual([]);
  });

  it("does not confirm a short payment: it is logged for staff, the payment stays pending", async () => {
    const { store, calls, recorded } = fakeStore();
    const response = await handleGatewayCallback(payment({ amount: 1000 }), result({ amount: 1 }), store, fixedNow);
    expect(response.status).toBe(400);
    expect(calls).toEqual(["record"]);
    expect(recorded[0].status).toBe("pending");
    expect(recorded[0].rawResponse).toMatchObject({ tolo_note: "amount_mismatch" });
  });

  it("acknowledges a still-in-progress callback without touching the payment", async () => {
    const { store, calls } = fakeStore();
    const response = await handleGatewayCallback(payment(), result({ outcome: "pending" }), store, fixedNow);
    expect(response).toEqual({ status: 200, body: { ok: true, pending: true } });
    expect(calls).toEqual(["record"]);
  });

  it("fails a pending payment on an authentic failure, once", async () => {
    const { store, calls, claims } = fakeStore();
    const response = await handleGatewayCallback(payment(), result({ outcome: "failed" }), store, fixedNow);
    expect(response.body).toEqual({ ok: false });
    expect(calls).toEqual(["record", "claim", "finalizeFailure"]);
    expect(claims[0]).toEqual({ from: ["pending"], to: "failed" });
  });

  it("sends the 'payment failed' side effects only for the delivery that wins the claim", async () => {
    const { store, calls } = fakeStore(false);
    await handleGatewayCallback(payment(), result({ outcome: "failed" }), store, fixedNow);
    expect(calls).not.toContain("finalizeFailure");
  });

  it("ignores a callback for a refunded payment", async () => {
    const { store, calls } = fakeStore();
    const response = await handleGatewayCallback(payment({ status: "refunded" }), result(), store, fixedNow);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ignored: true });
    expect(calls).toEqual([]);
  });
});

// The same pieces wired together the way payment-webhook and mock-gateway do it.
describe("mock gateway end to end", () => {
  const SECRET = "e2e-secret";
  const provider = createMockGatewayProvider("chapa", SECRET);
  const due = payment({ amount: 480 });
  const callback = { payment_id: "pay-1", reference: "mock_chapa_1", amount: 480, currency: "ETB" };

  it("a properly signed success settles the payment", async () => {
    const { rawBody, headers } = await buildMockCallback(SECRET, { ...callback, status: "success" });
    const { store, calls } = fakeStore();
    const response = await handleGatewayCallback(due, await provider.verify(rawBody, headers), store);
    expect(response.status).toBe(200);
    expect(calls).toContain("finalizeSuccess");
  });

  it("a forged 'failed' callback cannot fail someone's payment", async () => {
    const forged = await buildMockCallback("attacker-guess", { ...callback, status: "failed" });
    const { store, calls } = fakeStore();
    const response = await handleGatewayCallback(due, await provider.verify(forged.rawBody, forged.headers), store);
    expect(response.status).toBe(401);
    expect(calls).toEqual([]);
  });

  it("a signed callback edited to a smaller amount is rejected", async () => {
    const { rawBody, headers } = await buildMockCallback(SECRET, { ...callback, status: "success" });
    const { store, calls } = fakeStore();
    const response = await handleGatewayCallback(due, await provider.verify(rawBody.replace("480", "4"), headers), store);
    expect(response.status).toBe(401);
    expect(calls).toEqual([]);
  });

  it("a genuine callback for a different amount than the order is not confirmed", async () => {
    const { rawBody, headers } = await buildMockCallback(SECRET, { ...callback, amount: 4, status: "success" });
    const { store, calls } = fakeStore();
    const response = await handleGatewayCallback(due, await provider.verify(rawBody, headers), store);
    expect(response.status).toBe(400);
    expect(calls).not.toContain("finalizeSuccess");
  });
});
