import { describe, expect, it, vi } from "vitest";
import {
  attributeOrderLevelCharges,
  buildPayload,
  handleHandoff,
  paymentMethodFor,
  sendToToloDelivery,
  type DeliveryJobPayload,
  type HandoffDeps,
  type HandoffRequest,
  type JobRow,
  type OrderFacts,
} from "./logic.ts";

const KEY = "service-role-key";
const MO = "11111111-1111-4111-8111-111111111111";
const JOB = "22222222-2222-4222-8222-222222222222";

function facts(overrides: Partial<OrderFacts> = {}): OrderFacts {
  return {
    merchantOrderId: MO,
    status: "ready_for_pickup",
    orderNumber: 1042,
    orderPaymentStatus: "pending",
    paymentProviders: ["cash_on_delivery"],
    itemSubtotal: 450,
    discount: 0,
    deliveryFee: 60,
    riderTip: 0,
    items: [
      { name: "Doro Wat", quantity: 2 },
      { name: "Injera pack", quantity: 1 },
    ],
    pickup: { name: "Abebe's Kitchen", address: "Bole Rd, Addis Ababa", latitude: 9.01, longitude: 38.76, phone: "+251911000001" },
    dropoff: {
      name: "Sara T.",
      address: "Piassa, Addis Ababa",
      latitude: 9.03,
      longitude: 38.75,
      verifiedPhone: "+251911000002",
      addressPhone: "0911999999",
    },
    ...overrides,
  };
}

describe("paymentMethodFor", () => {
  it("is already_paid once the order is paid, whatever the provider", () => {
    expect(paymentMethodFor("paid", ["telebirr"])).toBe("already_paid");
    expect(paymentMethodFor("paid", ["cash_on_delivery"])).toBe("already_paid");
  });
  it("is cash_on_delivery for an unpaid cash order", () => {
    expect(paymentMethodFor("pending", ["cash_on_delivery"])).toBe("cash_on_delivery");
  });
  it("has no method for an online payment that isn't settled, or a refunded/failed order", () => {
    expect(paymentMethodFor("pending", ["telebirr"])).toBeNull();
    expect(paymentMethodFor("failed", ["cash_on_delivery"])).toBeNull();
    expect(paymentMethodFor("refunded", ["cash_on_delivery"])).toBeNull();
    expect(paymentMethodFor("pending", [])).toBeNull();
  });
});

describe("buildPayload", () => {
  it("carries every field the driver side needs", () => {
    const r = buildPayload(JOB, facts());
    expect(r).toEqual({
      ok: true,
      payload: {
        job_id: JOB,
        order_number: "TL-1042",
        pickup: { name: "Abebe's Kitchen", address: "Bole Rd, Addis Ababa", latitude: 9.01, longitude: 38.76, phone: "+251911000001" },
        dropoff: { name: "Sara T.", address: "Piassa, Addis Ababa", latitude: 9.03, longitude: 38.75, phone: "+251911000002", phone_verified: true },
        items: [
          { name: "Doro Wat", quantity: 2 },
          { name: "Injera pack", quantity: 1 },
        ],
        amounts: { currency: "ETB", item_subtotal: 450, discount: 0, delivery_fee: 60, rider_tip: 0 },
        payment: { method: "cash_on_delivery", driver_collects_cash: true },
      },
    });
  });

  it("differs between cash_on_delivery and already_paid only in how the driver is told to treat payment", () => {
    const cod = buildPayload(JOB, facts());
    const paid = buildPayload(JOB, facts({ orderPaymentStatus: "paid", paymentProviders: ["telebirr"] }));
    if (!cod.ok || !paid.ok) throw new Error("expected both to build");
    expect(cod.payload.payment).toEqual({ method: "cash_on_delivery", driver_collects_cash: true });
    expect(paid.payload.payment).toEqual({ method: "already_paid", driver_collects_cash: false });
    expect({ ...cod.payload, payment: null }).toEqual({ ...paid.payload, payment: null });
  });

  it("hands off components and never a total", () => {
    const r = buildPayload(JOB, facts({ discount: 50, riderTip: 20 }));
    if (!r.ok) throw new Error("expected payload");
    expect(r.payload.amounts).toEqual({ currency: "ETB", item_subtotal: 450, discount: 50, delivery_fee: 60, rider_tip: 20 });
    expect(Object.keys(r.payload.amounts).sort()).toEqual(["currency", "delivery_fee", "discount", "item_subtotal", "rider_tip"]);
    expect(Object.keys(r.payload.payment).sort()).toEqual(["driver_collects_cash", "method"]);
  });

  it("uses the Tolo-verified phone for the dropoff, never the address phone when a verified one exists", () => {
    const r = buildPayload(JOB, facts());
    if (!r.ok) throw new Error("expected payload");
    expect(r.payload.dropoff.phone).toBe("+251911000002");
    expect(JSON.stringify(r.payload)).not.toContain("0911999999");
  });

  it("falls back to the address phone, flagged unverified, when the customer has no Tolo session phone", () => {
    const f = facts();
    const r = buildPayload(JOB, { ...f, dropoff: { ...f.dropoff, verifiedPhone: null } });
    if (!r.ok) throw new Error("expected payload");
    expect(r.payload.dropoff).toMatchObject({ phone: "0911999999", phone_verified: false });
  });

  it("refuses what a driver couldn't act on", () => {
    expect(buildPayload(JOB, facts({ orderPaymentStatus: "pending", paymentProviders: ["telebirr"] }))).toEqual({ ok: false, error: "payment_not_settled" });
    expect(buildPayload(JOB, facts({ items: [] }))).toEqual({ ok: false, error: "no_items" });
    const f = facts();
    expect(buildPayload(JOB, { ...f, pickup: { ...f.pickup, address: null, latitude: null, longitude: null } })).toEqual({
      ok: false,
      error: "missing_pickup_location",
    });
    expect(buildPayload(JOB, { ...f, dropoff: { ...f.dropoff, address: null, latitude: null, longitude: null } })).toEqual({
      ok: false,
      error: "missing_dropoff_location",
    });
  });
});

describe("attributeOrderLevelCharges", () => {
  const charges = { deliveryFee: 60, riderTip: 10 };
  it("puts the delivery fee and tip on the first merchant order only", () => {
    expect(attributeOrderLevelCharges("a", ["a", "b"], charges)).toEqual(charges);
    expect(attributeOrderLevelCharges("b", ["a", "b"], charges)).toEqual({ deliveryFee: 0, riderTip: 0 });
  });
  it("leaves a single-merchant order untouched", () => {
    expect(attributeOrderLevelCharges("a", ["a"], charges)).toEqual(charges);
  });
});

// ---- the handler, against an in-memory stand-in for the database and a mock
// Tolo Delivery app ------------------------------------------------------

interface World {
  deps: HandoffDeps;
  jobs: Map<string, JobRow & { attempts: number; error: string | null }>;
  tolo: { received: DeliveryJobPayload[]; reply: () => Promise<Response> };
}

function world(f: OrderFacts | null = facts()): World {
  const jobs: World["jobs"] = new Map();
  const tolo: World["tolo"] = {
    received: [],
    reply: async () => new Response(JSON.stringify({ accepted: true }), { status: 200 }),
  };
  const fakeFetch = (async (_url: string, init: RequestInit) => {
    tolo.received.push(JSON.parse(init.body as string));
    return tolo.reply();
  }) as unknown as typeof fetch;

  const deps: HandoffDeps = {
    loadFacts: vi.fn(async () => f),
    getOrCreateJob: vi.fn(async (moId: string) => {
      if (!jobs.has(moId)) jobs.set(moId, { id: JOB, dispatched_at: null, attempts: 0, error: null });
      return jobs.get(moId)!;
    }),
    recordAttempt: vi.fn(async (_jobId, outcome) => {
      const job = [...jobs.values()][0];
      job.attempts += 1;
      job.error = outcome.ok ? null : outcome.error;
      if (outcome.ok) job.dispatched_at = "2026-10-03T10:00:00Z";
    }),
    send: (payload) => sendToToloDelivery(payload, { baseUrl: "https://tolo.test", sharedKey: "shared" }, fakeFetch),
  };
  return { deps, jobs, tolo };
}

function request(overrides: Partial<HandoffRequest> = {}): HandoffRequest {
  return { authorization: `Bearer ${KEY}`, expectedKey: KEY, enabled: true, body: { merchant_order_id: MO }, ...overrides };
}

describe("handleHandoff", () => {
  it("creates a job and sends the payload to the Tolo Delivery mock when an order is ready", async () => {
    const w = world();
    const res = await handleHandoff(request(), w.deps);
    expect(res).toEqual({ status: 200, body: { job_id: JOB, invoked: true } });
    expect(w.tolo.received).toHaveLength(1);
    expect(w.tolo.received[0]).toMatchObject({ job_id: JOB, order_number: "TL-1042", payment: { method: "cash_on_delivery", driver_collects_cash: true } });
    expect(w.jobs.get(MO)).toMatchObject({ attempts: 1, error: null });
    expect(w.jobs.get(MO)!.dispatched_at).not.toBeNull();
  });

  it("sends a prepaid order as already_paid with nothing for the driver to collect", async () => {
    const w = world(facts({ orderPaymentStatus: "paid", paymentProviders: ["telebirr"] }));
    await handleHandoff(request(), w.deps);
    expect(w.tolo.received[0].payment).toEqual({ method: "already_paid", driver_collects_cash: false });
  });

  it("is idempotent: a second call for an acknowledged job sends nothing", async () => {
    const w = world();
    await handleHandoff(request(), w.deps);
    const again = await handleHandoff(request(), w.deps);
    expect(again).toEqual({ status: 200, body: { job_id: JOB, already_invoked: true } });
    expect(w.tolo.received).toHaveLength(1);
  });

  it("keeps the job and records the error when the Tolo Delivery app is down, then retries cleanly", async () => {
    const w = world();
    w.tolo.reply = async () => new Response("boom", { status: 503 });
    const failed = await handleHandoff(request(), w.deps);
    expect(failed).toEqual({ status: 502, body: { job_id: JOB, error: "tolo_http_503" } });
    expect(w.jobs.get(MO)).toMatchObject({ dispatched_at: null, error: "tolo_http_503", attempts: 1 });

    w.tolo.reply = async () => new Response(JSON.stringify({ accepted: true }), { status: 200 });
    const retried = await handleHandoff(request(), w.deps);
    expect(retried.status).toBe(200);
    expect(w.jobs.get(MO)).toMatchObject({ error: null, attempts: 2 });
  });

  it("treats a 2xx without accepted:true, and a network failure, as failed handoffs", async () => {
    const rejected = world();
    rejected.tolo.reply = async () => new Response(JSON.stringify({ accepted: false }), { status: 200 });
    expect((await handleHandoff(request(), rejected.deps)).body).toMatchObject({ error: "tolo_rejected" });

    const down = world();
    down.tolo.reply = async () => {
      throw new Error("ECONNREFUSED");
    };
    expect((await handleHandoff(request(), down.deps)).body).toMatchObject({ error: "tolo_unreachable" });
  });

  it("records an unbuildable order on the job instead of sending it", async () => {
    const w = world(facts({ orderPaymentStatus: "pending", paymentProviders: ["telebirr"] }));
    const res = await handleHandoff(request(), w.deps);
    expect(res).toEqual({ status: 422, body: { job_id: JOB, error: "payment_not_settled" } });
    expect(w.tolo.received).toHaveLength(0);
    expect(w.jobs.get(MO)!.error).toBe("payment_not_settled");
  });

  it("only hands off orders that are ready for pickup, and knows when one doesn't exist", async () => {
    expect((await handleHandoff(request(), world(facts({ status: "cancelled" })).deps)).status).toBe(409);
    expect((await handleHandoff(request(), world(null).deps)).status).toBe(404);
  });

  it("does nothing at all while the integration is disabled: no job, no outbound call", async () => {
    const w = world();
    const res = await handleHandoff(request({ enabled: false }), w.deps);
    expect(res).toEqual({ status: 200, body: { skipped: "handoff_disabled" } });
    expect(w.deps.getOrCreateJob).not.toHaveBeenCalled();
    expect(w.tolo.received).toHaveLength(0);
  });

  it("rejects callers without the service-role key, and a bad body", async () => {
    const w = world();
    expect((await handleHandoff(request({ authorization: null }), w.deps)).status).toBe(403);
    expect((await handleHandoff(request({ authorization: "Bearer a-users-jwt" }), w.deps)).status).toBe(403);
    expect((await handleHandoff(request({ expectedKey: undefined }), w.deps)).status).toBe(503);
    expect((await handleHandoff(request({ body: { merchant_order_id: "nope" } }), w.deps)).status).toBe(400);
    expect((await handleHandoff(request({ body: null }), w.deps)).status).toBe(400);
    expect(w.deps.loadFacts).not.toHaveBeenCalled();
    expect(w.tolo.received).toHaveLength(0);
  });
});

describe("sendToToloDelivery", () => {
  it("is a failed handoff, not a crash, when the backend isn't configured", async () => {
    const r = buildPayload(JOB, facts());
    if (!r.ok) throw new Error("expected payload");
    expect(await sendToToloDelivery(r.payload, { baseUrl: undefined, sharedKey: "k" })).toEqual({ ok: false, error: "not_configured" });
    expect(await sendToToloDelivery(r.payload, { baseUrl: "https://x", sharedKey: undefined })).toEqual({ ok: false, error: "not_configured" });
  });

  it("posts to the documented path with the shared key as bearer", async () => {
    const r = buildPayload(JOB, facts());
    if (!r.ok) throw new Error("expected payload");
    const fake = vi.fn(async () => new Response(JSON.stringify({ accepted: true }), { status: 200 }));
    await sendToToloDelivery(r.payload, { baseUrl: "https://tolo.test", sharedKey: "shared" }, fake as unknown as typeof fetch);
    const [url, init] = fake.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://tolo.test/integrations/tolo-marketplace/delivery-jobs");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer shared");
    expect(init.method).toBe("POST");
  });
});
