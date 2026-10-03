import { describe, expect, it, vi } from "vitest";
import { handleCallback, type CallbackDeps, type StatusUpdate } from "./logic.ts";

const KEY = "test-inbound-key";
const JOB = "22222222-2222-4222-8222-222222222222";
const MO = "11111111-1111-4111-8111-111111111111";

function deps(overrides: Partial<CallbackDeps> = {}): CallbackDeps {
  return {
    apply: vi.fn(async () => ({ outcome: "applied" as const, merchantOrderId: MO })),
    afterApplied: vi.fn(async () => {}),
    ...overrides,
  };
}

function call(body: unknown, d: CallbackDeps, authorization: string | null = `Bearer ${KEY}`) {
  return handleCallback({ authorization, expectedKey: KEY, body }, d);
}

describe("handleCallback -- auth", () => {
  it("refuses everything when the key isn't configured", async () => {
    const d = deps();
    const res = await handleCallback({ authorization: "Bearer ", expectedKey: undefined, body: { job_id: JOB, status: "accepted" } }, d);
    expect(res.status).toBe(503);
    expect(d.apply).not.toHaveBeenCalled();
  });

  it("rejects a missing or wrong key before touching anything", async () => {
    const d = deps();
    const body = { job_id: JOB, status: "accepted", driver_ref: "d1" };
    expect((await call(body, d, null)).status).toBe(401);
    expect((await call(body, d, "Bearer wrong")).status).toBe(401);
    expect((await call(body, d, KEY)).status).toBe(401);
    expect((await call(body, d, "Bearer ")).status).toBe(401);
    expect(d.apply).not.toHaveBeenCalled();
    expect(d.afterApplied).not.toHaveBeenCalled();
  });
});

describe("handleCallback -- validation", () => {
  it.each([
    [{}],
    [null],
    [{ job_id: "nope", status: "accepted" }],
    [{ job_id: JOB }],
    [{ job_id: JOB, status: "invoked" }],
    [{ job_id: JOB, status: "teleported" }],
    [{ job_id: JOB, status: "accepted", driver_ref: 42 }],
    [{ job_id: JOB, status: "accepted", driver_ref: "x".repeat(101) }],
    [{ job_id: JOB, status: "accepted", eta_minutes: -1 }],
    [{ job_id: JOB, status: "accepted", eta_minutes: 1.5 }],
    [{ job_id: JOB, status: "accepted", eta_minutes: "10" }],
    [{ job_id: JOB, status: "accepted", eta_minutes: 5000 }],
    [{ job_id: JOB, status: "failed", failure_reason: "x".repeat(501) }],
  ])("rejects %j with 400 and applies nothing", async (body) => {
    const d = deps();
    expect((await call(body, d)).status).toBe(400);
    expect(d.apply).not.toHaveBeenCalled();
  });
});

describe("handleCallback -- applying", () => {
  it("passes a normalized update through and reports it applied", async () => {
    const d = deps();
    const res = await call({ job_id: JOB, status: "accepted", driver_ref: "  drv-7 ", eta_minutes: 20 }, d);
    expect(res).toEqual({ status: 200, body: { ok: true, job_id: JOB, status: "accepted", applied: true } });
    const expected: StatusUpdate = { jobId: JOB, status: "accepted", driverRef: "drv-7", etaMinutes: 20, failureReason: null };
    expect(d.apply).toHaveBeenCalledWith(expected);
    expect(d.afterApplied).toHaveBeenCalledWith(expected, MO);
  });

  it("accepts a failure with a reason and no driver", async () => {
    const d = deps();
    await call({ job_id: JOB, status: "failed", failure_reason: " customer unreachable " }, d);
    expect(d.apply).toHaveBeenCalledWith({ jobId: JOB, status: "failed", driverRef: null, etaMinutes: null, failureReason: "customer unreachable" });
  });

  it("a repeated callback is a 200 no-op that notifies nobody", async () => {
    const d = deps({ apply: vi.fn(async () => ({ outcome: "unchanged" as const, merchantOrderId: MO })) });
    const res = await call({ job_id: JOB, status: "delivered" }, d);
    expect(res).toEqual({ status: 200, body: { ok: true, job_id: JOB, status: "delivered", applied: false } });
    expect(d.afterApplied).not.toHaveBeenCalled();
  });

  it.each([
    ["job_not_found", 404],
    ["invalid_transition", 409],
    ["driver_ref_required", 422],
    ["invalid_status", 400],
  ])("maps the database error %s to HTTP %i", async (code, status) => {
    const d = deps({ apply: vi.fn(async () => Promise.reject(new Error(code))) });
    const res = await call({ job_id: JOB, status: "picked_up", driver_ref: "d" }, d);
    expect(res.status).toBe(status);
    expect(d.afterApplied).not.toHaveBeenCalled();
  });

  it("lets an unexpected failure surface (the function turns it into a 500)", async () => {
    const d = deps({ apply: vi.fn(async () => Promise.reject(new Error("connection reset"))) });
    await expect(call({ job_id: JOB, status: "accepted", driver_ref: "d" }, d)).rejects.toThrow("connection reset");
  });
});
