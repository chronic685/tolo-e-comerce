import { beforeAll, describe, expect, inject, it } from "vitest";
import { env, serviceClient, signIn } from "../env.ts";
import { callFunction } from "../helpers.ts";

// Regression coverage for the exact vulnerability class fixed this session:
// payment-webhook was public/unauthenticated and trusted a client-supplied
// {status:"success"} body as proof of payment. See tests/README.md for the
// full writeup. These tests reproduce the original spoof attempts and
// assert they are now rejected, with no side effect on the payment record.
describe("payment anti-spoofing: payment-webhook", () => {
  const db = serviceClient();

  it("rejects a spoofed success payload for a real pending payment (no gateway is registered)", async () => {
    const fixtures = inject("qaFixtures");

    const res = await callFunction(`payment-webhook/${fixtures.paymentId}`, {
      body: { status: "success", verified: true, reference: "spoofed-by-test" },
    });
    expect(res.status).toBe(400);

    const { data: payment } = await db.from("payments").select("status").eq("id", fixtures.paymentId).single();
    expect(payment!.status).toBe("pending");
  });

  it("ignores a client-supplied provider/amount override — the DB's own provider and amount are authoritative", async () => {
    const fixtures = inject("qaFixtures");

    // Attempt to make the webhook think this is a gateway-backed payment
    // for a different (larger or smaller) amount than the real order.
    const res = await callFunction(`payment-webhook/${fixtures.paymentId}`, {
      body: { status: "success", provider: "chapa", amount: 1, order_id: "attacker-controlled" },
    });
    expect(res.status).toBe(400);

    const { data: payment } = await db.from("payments").select("status, amount, provider").eq("id", fixtures.paymentId).single();
    expect(payment!.status).toBe("pending");
    expect(payment!.provider).toBe("cash_on_delivery"); // untouched — the body's "provider" field was never used
  });

  it("rejects a spoofed success payload for a non-existent payment id (404, not a silent success)", async () => {
    const res = await callFunction("payment-webhook/00000000-0000-0000-0000-000000000000", {
      body: { status: "success" },
    });
    expect(res.status).toBe(404);
  });
});

describe("payment anti-spoofing: confirm-payment authorization", () => {
  let merchantBToken: string;
  let customerToken: string;

  beforeAll(async () => {
    merchantBToken = await signIn(env.qaMerchantBEmail, env.qaMerchantBPassword);
    customerToken = await signIn(env.qaCustomerEmail, env.qaCustomerPassword);
  });

  it("an unrelated merchant cannot confirm another merchant's cash payment", async () => {
    const fixtures = inject("qaFixtures");
    const res = await callFunction("confirm-payment", {
      token: merchantBToken,
      body: { payment_id: fixtures.paymentId },
    });
    expect(res.status).toBe(403);
  });

  it("a customer (not staff, not the merchant) cannot confirm a payment, even their own order's", async () => {
    const fixtures = inject("qaFixtures");
    const res = await callFunction("confirm-payment", {
      token: customerToken,
      body: { payment_id: fixtures.paymentId },
    });
    expect(res.status).toBe(403);
  });
});

describe("webhook/confirmation idempotency", () => {
  const db = serviceClient();

  it("re-confirming an already-verified payment is a safe no-op, not a duplicate side effect", async () => {
    const { data: verifiedPayment } = await db.from("payments").select("id").eq("status", "verified").limit(1).maybeSingle();
    if (!verifiedPayment) {
      console.warn("NOT COVERED: no pre-existing verified payment found (expected the migration 0018 demo seed) — skipping.");
      return;
    }

    const staffToken = await signIn(env.qaStaffEmail, env.qaStaffPassword);
    const before = await db.from("wallet_transactions").select("id", { count: "exact", head: true });

    const res = await callFunction("confirm-payment", { token: staffToken, body: { payment_id: verifiedPayment.id } });
    expect(res.status).toBe(200);
    expect((res.json as { already_processed?: boolean })?.already_processed).toBe(true);

    const after = await db.from("wallet_transactions").select("id", { count: "exact", head: true });
    expect(after.count).toBe(before.count);
  });
});
