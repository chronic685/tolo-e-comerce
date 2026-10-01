import { describe, expect, it, vi } from "vitest";
import { constantTimeEqual, handleStatus, type PhoneStatusRow, type StatusDeps } from "./logic.ts";

const KEY = "test-inbound-key";
const NONE: PhoneStatusRow = {
  application_id: null,
  application_status: null,
  submitted_at: null,
  reviewed_at: null,
  admin_note: null,
  is_merchant: false,
  merchant_id: null,
};

function deps(row: Partial<PhoneStatusRow> = {}): StatusDeps {
  return { lookup: vi.fn(async () => ({ ...NONE, ...row })) };
}

function call(body: unknown, d: StatusDeps, authorization: string | null = `Bearer ${KEY}`) {
  return handleStatus({ authorization, expectedKey: KEY, body }, d);
}

describe("handleStatus -- auth", () => {
  it("refuses everything when the key isn't configured", async () => {
    const d = deps();
    expect(await handleStatus({ authorization: "Bearer ", expectedKey: undefined, body: { phone: "0912345678" } }, d)).toMatchObject({
      ok: false,
      status: 503,
    });
    expect(d.lookup).not.toHaveBeenCalled();
  });

  it("refuses a missing or wrong key before looking anything up", async () => {
    const d = deps();
    expect(await call({ phone: "0912345678" }, d, null)).toMatchObject({ ok: false, status: 401 });
    expect(await call({ phone: "0912345678" }, d, "Bearer wrong")).toMatchObject({ ok: false, status: 401 });
    expect(await call({ phone: "0912345678" }, d, KEY)).toMatchObject({ ok: false, status: 401 });
    expect(d.lookup).not.toHaveBeenCalled();
  });

  it("constantTimeEqual compares exactly", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
    expect(constantTimeEqual("", "")).toBe(true);
  });
});

describe("handleStatus -- lookup", () => {
  it("normalizes the phone the same way tolo-app-login does", async () => {
    const d = deps();
    const result = await call({ phone: "0912 345 678" }, d);
    expect(d.lookup).toHaveBeenCalledWith("+251912345678");
    expect(result).toEqual({ ok: true, body: { phone: "+251912345678", is_merchant: false, application: null } });
  });

  it("rejects a phone that can't be normalized", async () => {
    expect(await call({ phone: "12345" }, deps())).toMatchObject({ ok: false, status: 400 });
    expect(await call({}, deps())).toMatchObject({ ok: false, status: 400 });
  });

  it("pending: no Merchant button yet", async () => {
    const result = await call({ phone: "+251912345678" }, deps({ application_id: "a1", application_status: "pending", submitted_at: "t0" }));
    expect(result).toMatchObject({ ok: true, body: { is_merchant: false, application: { id: "a1", status: "pending", note: null } } });
  });

  it("approved: show the Merchant button, and keep the approval note internal", async () => {
    const result = await call(
      { phone: "+251912345678" },
      deps({ application_id: "a1", application_status: "approved", admin_note: "internal", is_merchant: true, merchant_id: "m1" }),
    );
    expect(result).toMatchObject({ ok: true, body: { is_merchant: true, application: { status: "approved", note: null } } });
  });

  it("rejected: passes the admin's note through so the app can show what to fix", async () => {
    const result = await call({ phone: "+251912345678" }, deps({ application_id: "a1", application_status: "rejected", admin_note: "Blurry license" }));
    expect(result).toMatchObject({ ok: true, body: { is_merchant: false, application: { status: "rejected", note: "Blurry license" } } });
  });
});
