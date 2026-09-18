import { describe, expect, it } from "vitest";
import { callFunction, preflight } from "../helpers.ts";

// Regression coverage for the exact bug class fixed this session: several
// functions ran their full handler (including auth checks) on the browser's
// CORS preflight OPTIONS request instead of short-circuiting it, so the
// preflight got a 401 and the browser silently blocked the real request
// before it was ever sent — surfacing to users as "Failed to send a request
// to the Edge Function" with no useful error. See tests/README.md.
const BROWSER_FACING_FUNCTIONS = [
  "checkout",
  "order-status",
  "payment-webhook",
  "confirm-payment",
  "delivery-dispatch",
  "settlement-run",
  "commission-calc",
];

describe.each(BROWSER_FACING_FUNCTIONS)("CORS: %s", (name) => {
  it("answers the preflight OPTIONS request with 200, not the handler's auth logic", async () => {
    const res = await preflight(name);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeTruthy();
    expect(res.headers.get("access-control-allow-headers")).toContain("authorization");
  });

  it("still carries CORS headers on the real request's response, even when it's an error", async () => {
    // Deliberately invalid body — every one of these functions should
    // reject it (400/401/403/404), but the *response itself* (whatever its
    // status) must still be readable by the browser, i.e. carry CORS
    // headers. A response without them causes the exact silent failure
    // this test suite exists to prevent.
    const res = await callFunction(name, { body: {} });
    expect(res.headers.get("access-control-allow-origin")).toBeTruthy();
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
