import { beforeAll, describe, expect, it } from "vitest";
import { env, signIn } from "../env.ts";
import { callFunction } from "../helpers.ts";

// The backend must never trust the frontend to have validated anything —
// every one of these must reject missing/invalid input with 400, using a
// *validly authenticated* caller so the test actually reaches the
// validation code instead of failing earlier on the auth check.
describe("input validation", () => {
  let customerToken: string;
  let merchantAToken: string;
  let staffToken: string;

  beforeAll(async () => {
    customerToken = await signIn(env.qaCustomerEmail, env.qaCustomerPassword);
    merchantAToken = await signIn(env.qaMerchantAEmail, env.qaMerchantAPassword);
    staffToken = await signIn(env.qaStaffEmail, env.qaStaffPassword);
  });

  it("checkout rejects a request missing address_id and payment_provider", async () => {
    const res = await callFunction("checkout", { token: customerToken, body: {} });
    expect(res.status).toBe(400);
  });

  it("checkout rejects a request with a well-formed but non-existent address_id", async () => {
    const res = await callFunction("checkout", {
      token: customerToken,
      body: { address_id: "00000000-0000-0000-0000-000000000000", payment_provider: "cash_on_delivery" },
    });
    // Cart is empty for this account either way, so this is expected to
    // fail before address lookup even matters — the point is it must be a
    // clean 4xx, never a 2xx or an unhandled 500.
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it("order-status rejects a request missing merchant_order_id and status", async () => {
    const res = await callFunction("order-status", { token: merchantAToken, body: {} });
    expect(res.status).toBe(400);
  });

  it("order-status rejects a non-existent merchant_order_id", async () => {
    const res = await callFunction("order-status", {
      token: merchantAToken,
      body: { merchant_order_id: "00000000-0000-0000-0000-000000000000", status: "accepted" },
    });
    expect(res.status).toBe(404);
  });

  it("confirm-payment rejects a request missing payment_id", async () => {
    const res = await callFunction("confirm-payment", { token: merchantAToken, body: {} });
    expect(res.status).toBe(400);
  });

  it("confirm-payment rejects a non-existent payment_id", async () => {
    const res = await callFunction("confirm-payment", {
      token: merchantAToken,
      body: { payment_id: "00000000-0000-0000-0000-000000000000" },
    });
    expect(res.status).toBe(404);
  });

  it("settlement-run rejects a request missing merchant_id/period_start/period_end", async () => {
    const res = await callFunction("settlement-run", { token: staffToken, body: {} });
    expect(res.status).toBe(400);
  });

  it("delivery-dispatch rejects a request missing delivery_id and status", async () => {
    const res = await callFunction("delivery-dispatch", { token: staffToken, body: {} });
    expect(res.status).toBe(400);
  });

  it("delivery-dispatch rejects a non-existent delivery_id", async () => {
    const res = await callFunction("delivery-dispatch", {
      token: staffToken,
      body: { delivery_id: "00000000-0000-0000-0000-000000000000", status: "picked_up" },
    });
    expect(res.status).toBe(404);
  });
});
