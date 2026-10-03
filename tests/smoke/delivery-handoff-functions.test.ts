import { beforeAll, describe, expect, inject, it } from "vitest";
import { env, serviceClient, signIn } from "../env.ts";
import { callFunction } from "../helpers.ts";

// The delivery handoff end to end under CI's Deno runtime: a merchant moves a
// real order to ready_for_pickup through order-status, which fires
// delivery-handoff, which POSTs to the Tolo Delivery mock
// (tests/ci/tolo-backend-stub.mjs). See docs/integration/delivery-handoff.md.
//
// Needs the stub, which only CI starts, and creates orders -- so like
// tolo-app-functions.test.ts it runs only where the workflow sets these.
const INBOUND_KEY = process.env.TOLO_CI_INBOUND_KEY;
const SHARED_KEY = process.env.TOLO_CI_SHARED_KEY;
const STUB_URL = process.env.TOLO_CI_STUB_URL ?? "http://127.0.0.1:54399";

interface Payload {
  job_id: string;
  order_number: string;
  pickup: { phone: string | null; address: string | null };
  dropoff: { phone: string | null; phone_verified: boolean };
  items: { name: string; quantity: number }[];
  amounts: { item_subtotal: number; delivery_fee: number };
  payment: { method: string; driver_collects_cash: boolean };
}

async function stubReceived(): Promise<Payload[]> {
  const res = await fetch(`${STUB_URL}/integrations/tolo-marketplace/_stub/delivery-jobs`, { headers: { Authorization: `Bearer ${SHARED_KEY}` } });
  expect(res.status).toBe(200);
  return ((await res.json()) as { jobs: Payload[] }).jobs;
}

describe.skipIf(!INBOUND_KEY || !SHARED_KEY)("delivery handoff under the Deno runtime", () => {
  const db = serviceClient();
  let merchantAToken: string;
  let merchantBToken: string;
  let customerToken: string;
  let addressId: string;
  let variantId: string;
  let customerUserId: string;

  beforeAll(async () => {
    merchantAToken = await signIn(env.qaMerchantAEmail, env.qaMerchantAPassword);
    merchantBToken = await signIn(env.qaMerchantBEmail, env.qaMerchantBPassword);
    customerToken = await signIn(env.qaCustomerEmail, env.qaCustomerPassword);
    ({ addressId, variantId, customerUserId } = inject("qaFixtures"));

    // The QA store has no pickup location; a job can't be sent without one.
    const updated = await db.from("stores").update({ pickup_address: "QA Pickup Street, Addis Ababa" }).like("name", "QA TEST Store%");
    expect(updated.error).toBeNull();
  });

  /** A real order through checkout's create_order(), with the payment checkout would have recorded. */
  async function order(paid: boolean) {
    const { data: orderId, error } = await db.rpc("create_order", {
      p_customer_id: customerUserId,
      p_address_id: addressId,
      p_items: [{ variant_id: variantId, quantity: 2 }],
    });
    if (error) throw error;
    const { data: mo } = await db.from("merchant_orders").select("id").eq("order_id", orderId as string).single();
    const { data: o } = await db.from("orders").select("order_number, total").eq("id", orderId as string).single();
    await db.from("payments").insert({
      order_id: orderId,
      provider: paid ? "telebirr" : "cash_on_delivery",
      amount: o!.total,
      status: paid ? "verified" : "pending",
    });
    if (paid) await db.from("orders").update({ payment_status: "paid" }).eq("id", orderId as string);
    return { merchantOrderId: mo!.id as string, orderNumber: `TL-${o!.order_number}` };
  }

  async function moveToReady(merchantOrderId: string) {
    for (const status of ["accepted", "processing", "ready_for_pickup"]) {
      const res = await callFunction("order-status", { token: merchantAToken, body: { merchant_order_id: merchantOrderId, status } });
      expect(res.status, JSON.stringify(res.json)).toBe(200);
    }
  }

  async function jobFor(merchantOrderId: string) {
    const { data } = await db.from("delivery_jobs").select("*").eq("merchant_order_id", merchantOrderId).maybeSingle();
    return data;
  }

  it("marking a cash-on-delivery order ready creates a job and sends the mock the right payload", async () => {
    const { merchantOrderId, orderNumber } = await order(false);
    await moveToReady(merchantOrderId);

    const job = await jobFor(merchantOrderId);
    expect(job).toMatchObject({ status: "invoked", handoff_error: null, handoff_attempts: 1 });
    expect(job!.dispatched_at).not.toBeNull();

    const sent = (await stubReceived()).find((p) => p.job_id === job!.id);
    expect(sent).toBeDefined();
    expect(sent!.order_number).toBe(orderNumber);
    expect(sent!.items).toEqual([{ name: "QA TEST Product — DO NOT USE", quantity: 2 }]);
    expect(sent!.amounts.item_subtotal).toBeGreaterThan(0);
    expect(sent!.pickup.address).toBe("QA Pickup Street, Addis Ababa");
    expect(sent!.payment).toEqual({ method: "cash_on_delivery", driver_collects_cash: true });
    // The QA customer signed in by password, so has no Tolo session phone.
    expect(sent!.dropoff).toMatchObject({ phone: "+251900000003", phone_verified: false });
  });

  it("a prepaid order is sent as already_paid and the driver collects nothing", async () => {
    const { merchantOrderId } = await order(true);
    await moveToReady(merchantOrderId);
    const job = await jobFor(merchantOrderId);
    const sent = (await stubReceived()).find((p) => p.job_id === job!.id);
    expect(sent!.payment).toEqual({ method: "already_paid", driver_collects_cash: false });
  });

  it("calling the handoff again never creates a second job or a second send", async () => {
    const { merchantOrderId } = await order(false);
    await moveToReady(merchantOrderId);
    const job = await jobFor(merchantOrderId);

    const again = await callFunction("delivery-handoff", {
      token: env.serviceRoleKey,
      body: { merchant_order_id: merchantOrderId },
    });
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ job_id: job!.id, already_invoked: true });
    expect((await stubReceived()).filter((p) => p.job_id === job!.id)).toHaveLength(1);
    const { count } = await db.from("delivery_jobs").select("id", { count: "exact", head: true }).eq("merchant_order_id", merchantOrderId);
    expect(count).toBe(1);
  });

  it("delivery-handoff is internal: users and anon can't call it", async () => {
    const { merchantOrderId } = await order(false);
    for (const token of [merchantAToken, customerToken, undefined]) {
      const res = await callFunction("delivery-handoff", { token, body: { merchant_order_id: merchantOrderId } });
      expect(res.status).toBe(403);
    }
    expect(await jobFor(merchantOrderId)).toBeNull();
  });

  it("an order that isn't ready never gets a job", async () => {
    const { merchantOrderId } = await order(false);
    const res = await callFunction("delivery-handoff", { token: env.serviceRoleKey, body: { merchant_order_id: merchantOrderId } });
    expect(res.status).toBe(409);
    expect(await jobFor(merchantOrderId)).toBeNull();
  });

  it("the customer who owns the order can read its delivery status; a non-owner can't", async () => {
    const { merchantOrderId } = await order(false);
    await moveToReady(merchantOrderId);
    const job = await jobFor(merchantOrderId);

    const asUser = async (token: string) => {
      const { createClient } = await import("@supabase/supabase-js");
      const client = createClient(env.supabaseUrl, env.anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
      return client.from("delivery_jobs").select("id, status").eq("id", job!.id);
    };
    expect((await asUser(customerToken)).data).toEqual([{ id: job!.id, status: "invoked" }]);
    expect((await asUser(merchantAToken)).data).toHaveLength(1); // the order's own merchant
    expect((await asUser(merchantBToken)).data).toEqual([]); // another merchant
  });

  describe("inbound status callback", () => {
    const callback = (body: unknown, key: string | null = INBOUND_KEY!) =>
      callFunction("delivery-status-callback", { token: key ?? undefined, body });

    async function readyJob() {
      const { merchantOrderId } = await order(false);
      await moveToReady(merchantOrderId);
      const job = await jobFor(merchantOrderId);
      return { merchantOrderId, jobId: job!.id as string };
    }

    async function orderStatus(merchantOrderId: string) {
      const { data } = await db.from("merchant_orders").select("status").eq("id", merchantOrderId).single();
      return data!.status as string;
    }

    it("walks a job through assigned, picked up and delivered, and the order follows", async () => {
      const { merchantOrderId, jobId } = await readyJob();

      const accepted = await callback({ job_id: jobId, status: "accepted", driver_ref: "drv-ci-1", eta_minutes: 25 });
      expect(accepted.status, JSON.stringify(accepted.json)).toBe(200);
      expect(await jobFor(merchantOrderId)).toMatchObject({ status: "accepted", driver_ref: "drv-ci-1" });
      expect((await jobFor(merchantOrderId))!.eta_at).not.toBeNull();
      expect(await orderStatus(merchantOrderId)).toBe("ready_for_pickup");

      expect((await callback({ job_id: jobId, status: "picked_up" })).status).toBe(200);
      expect(await orderStatus(merchantOrderId)).toBe("picked_up");

      expect((await callback({ job_id: jobId, status: "delivered" })).status).toBe(200);
      expect(await jobFor(merchantOrderId)).toMatchObject({ status: "delivered", eta_at: null });
      expect(await orderStatus(merchantOrderId)).toBe("completed");

      // The customer's own view of it.
      const { createClient } = await import("@supabase/supabase-js");
      const client = createClient(env.supabaseUrl, env.anonKey, { global: { headers: { Authorization: `Bearer ${customerToken}` } } });
      const { data } = await client.from("delivery_jobs").select("status, driver_ref").eq("id", jobId);
      expect(data).toEqual([{ status: "delivered", driver_ref: "drv-ci-1" }]);
    });

    it("rejects a missing, wrong or user-token key, and changes nothing", async () => {
      const { merchantOrderId, jobId } = await readyJob();
      const body = { job_id: jobId, status: "accepted", driver_ref: "drv-evil" };
      expect((await callback(body, null)).status).toBe(401); // sends the anon key as bearer
      expect((await callback(body, "wrong-key")).status).toBe(401);
      expect((await callback(body, customerToken)).status).toBe(401);
      expect((await callback(body, merchantAToken)).status).toBe(401);
      expect(await jobFor(merchantOrderId)).toMatchObject({ status: "invoked", driver_ref: null });
    });

    it("refuses an unknown job, a bad status and a status that can't follow", async () => {
      const { jobId } = await readyJob();
      expect((await callback({ job_id: "00000000-0000-4000-8000-000000000000", status: "accepted", driver_ref: "d" })).status).toBe(404);
      expect((await callback({ job_id: jobId, status: "teleported" })).status).toBe(400);
      expect((await callback({ job_id: jobId, status: "accepted" })).status).toBe(422); // no driver_ref
      await callback({ job_id: jobId, status: "accepted", driver_ref: "d" });
      await callback({ job_id: jobId, status: "picked_up" });
      expect((await callback({ job_id: jobId, status: "accepted" })).status).toBe(409);
    });

    it("a failed delivery is recorded and leaves the order for ops", async () => {
      const { merchantOrderId, jobId } = await readyJob();
      expect((await callback({ job_id: jobId, status: "failed", failure_reason: "customer unreachable" })).status).toBe(200);
      expect(await jobFor(merchantOrderId)).toMatchObject({ status: "failed", failure_reason: "customer unreachable" });
      expect(await orderStatus(merchantOrderId)).toBe("ready_for_pickup");
    });
  });
});
