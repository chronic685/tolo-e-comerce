import { beforeAll, describe, expect, inject, it } from "vitest";
import { env, signIn } from "../env.ts";
import { callFunction } from "../helpers.ts";

// Every one of these functions must authenticate the caller before doing
// anything else — none of them may perform their protected action, return
// data, or change state for an unauthenticated or malformed-token request.
const AUTHENTICATED_FUNCTIONS = ["checkout", "order-status", "confirm-payment", "delivery-dispatch", "settlement-run", "commission-calc"];

describe.each(AUTHENTICATED_FUNCTIONS)("authentication: %s", (name) => {
  it("rejects a request with no real session (anon key only) with 401", async () => {
    const res = await callFunction(name, { body: {} });
    expect(res.status).toBe(401);
  });

  it("rejects a malformed/garbage bearer token with 401", async () => {
    const res = await callFunction(name, { token: "not-a-real-jwt.garbage.value", body: {} });
    expect(res.status).toBe(401);
  });
});

describe("authentication: valid session succeeds", () => {
  let merchantAToken: string;

  beforeAll(async () => {
    merchantAToken = await signIn(env.qaMerchantAEmail, env.qaMerchantAPassword);
  });

  it("commission-calc returns 2xx for a real, authenticated, read-only request", async () => {
    const fixtures = inject("qaFixtures");
    const res = await callFunction("commission-calc", {
      token: merchantAToken,
      query: { merchant_id: fixtures.merchantAId },
    });
    expect(res.status).toBeLessThan(300);
    expect((res.json as { rate_percent?: number })?.rate_percent).toBeTypeOf("number");
  });
});
