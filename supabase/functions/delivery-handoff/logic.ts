// Decision logic for handing a ready-for-pickup order to the Tolo Delivery
// app (contract: docs/integration/delivery-handoff.md), free of Deno/network/
// database code so it runs under plain Vitest -- same split as
// merchant-application-status/logic.ts.
import { checkBearerKey } from "../_shared/inbound_auth.ts";
import { formatOrderNumber } from "../_shared/format.ts";

export type PaymentMethod = "cash_on_delivery" | "already_paid";

/** Everything the payload is built from, as read from the database. */
export interface OrderFacts {
  merchantOrderId: string;
  /** merchant_orders.status */
  status: string;
  orderNumber: number;
  /** orders.payment_status */
  orderPaymentStatus: string;
  /** payments.provider values for the order, newest first. */
  paymentProviders: string[];
  /** merchant_orders.subtotal: this merchant's items, before any discount. */
  itemSubtotal: number;
  /** merchant_orders.discount_amount: this merchant's share of the order discount. */
  discount: number;
  /** orders.delivery_fee, already attributed to this job (see attributeOrderLevelCharges). */
  deliveryFee: number;
  riderTip: number;
  items: { name: string; quantity: number }[];
  pickup: { name: string | null; address: string | null; latitude: number | null; longitude: number | null; phone: string | null };
  dropoff: {
    name: string | null;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
    /** The phone linked to the customer's Tolo session (tolo_phone_links), if any. */
    verifiedPhone: string | null;
    /** The phone typed into the delivery address, used only when there is no verified one. */
    addressPhone: string | null;
  };
}

export interface DeliveryJobPayload {
  job_id: string;
  order_number: string;
  pickup: { name: string | null; address: string | null; latitude: number | null; longitude: number | null; phone: string | null };
  dropoff: {
    name: string | null;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
    phone: string | null;
    phone_verified: boolean;
  };
  items: { name: string; quantity: number }[];
  // Components only. The marketplace deliberately does not add these up: the
  // Tolo Delivery app computes what the driver sees from them.
  amounts: { currency: "ETB"; item_subtotal: number; discount: number; delivery_fee: number; rider_tip: number };
  payment: { method: PaymentMethod; driver_collects_cash: boolean };
}

export type BuildResult = { ok: true; payload: DeliveryJobPayload } | { ok: false; error: string };

/** A multi-merchant checkout has one delivery fee and one tip for the whole
 * order but one job per merchant. Charging both on every job would have the
 * driver of each one collect them again, so the first merchant order (by
 * creation, then id) carries them and the rest carry 0. */
export function attributeOrderLevelCharges(
  merchantOrderId: string,
  siblingIdsInCreationOrder: string[],
  orderCharges: { deliveryFee: number; riderTip: number },
): { deliveryFee: number; riderTip: number } {
  return siblingIdsInCreationOrder[0] === merchantOrderId ? orderCharges : { deliveryFee: 0, riderTip: 0 };
}

/** paid -> already_paid; unpaid cash-on-delivery -> cash_on_delivery; anything
 * else (an online payment still pending/failed/refunded) isn't something a
 * driver can act on, so there's no method and the job isn't sent. */
export function paymentMethodFor(orderPaymentStatus: string, paymentProvidersNewestFirst: string[]): PaymentMethod | null {
  if (orderPaymentStatus === "paid") return "already_paid";
  if (orderPaymentStatus === "pending" && paymentProvidersNewestFirst[0] === "cash_on_delivery") return "cash_on_delivery";
  return null;
}

export function buildPayload(jobId: string, facts: OrderFacts): BuildResult {
  const method = paymentMethodFor(facts.orderPaymentStatus, facts.paymentProviders);
  if (!method) return { ok: false, error: "payment_not_settled" };
  if (facts.items.length === 0) return { ok: false, error: "no_items" };
  if (!facts.pickup.address && facts.pickup.latitude === null) return { ok: false, error: "missing_pickup_location" };
  if (!facts.dropoff.address && facts.dropoff.latitude === null) return { ok: false, error: "missing_dropoff_location" };

  const dropoffPhone = facts.dropoff.verifiedPhone ?? facts.dropoff.addressPhone;
  return {
    ok: true,
    payload: {
      job_id: jobId,
      order_number: formatOrderNumber(facts.orderNumber),
      pickup: { ...facts.pickup },
      dropoff: {
        name: facts.dropoff.name,
        address: facts.dropoff.address,
        latitude: facts.dropoff.latitude,
        longitude: facts.dropoff.longitude,
        phone: dropoffPhone,
        phone_verified: facts.dropoff.verifiedPhone !== null,
      },
      items: facts.items.map((i) => ({ name: i.name, quantity: i.quantity })),
      amounts: {
        currency: "ETB",
        item_subtotal: facts.itemSubtotal,
        discount: facts.discount,
        delivery_fee: facts.deliveryFee,
        rider_tip: facts.riderTip,
      },
      payment: { method, driver_collects_cash: method === "cash_on_delivery" },
    },
  };
}

export interface JobRow {
  id: string;
  /** Set once the Tolo Delivery app acknowledged the job. */
  dispatched_at: string | null;
}

export interface HandoffDeps {
  loadFacts(merchantOrderId: string): Promise<OrderFacts | null>;
  /** Returns the order's existing job, or creates it (status `invoked`). */
  getOrCreateJob(merchantOrderId: string): Promise<JobRow>;
  /** Records one handoff attempt: acknowledged, or why not. Counts it. */
  recordAttempt(jobId: string, outcome: { ok: true } | { ok: false; error: string }): Promise<void>;
  /** POSTs the payload to the Tolo Delivery app. */
  send(payload: DeliveryJobPayload): Promise<{ ok: true } | { ok: false; error: string }>;
}

export interface HandoffRequest {
  authorization: string | null;
  /** SUPABASE_SERVICE_ROLE_KEY: this function is internal, called only by order-status. */
  expectedKey: string | undefined;
  /** TOLO_DELIVERY_HANDOFF_ENABLED === "true". Off until the Tolo Delivery backend exists. */
  enabled: boolean;
  body: unknown;
}

export type HandoffResult = { status: number; body: Record<string, unknown> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleHandoff(req: HandoffRequest, deps: HandoffDeps): Promise<HandoffResult> {
  const auth = checkBearerKey(req.authorization, req.expectedKey);
  if (auth === "not_configured") return { status: 503, body: { error: "Not configured." } };
  if (auth === "unauthorized") return { status: 403, body: { error: "Not authorized." } };

  const merchantOrderId = (req.body as { merchant_order_id?: unknown } | null)?.merchant_order_id;
  if (typeof merchantOrderId !== "string" || !UUID.test(merchantOrderId)) {
    return { status: 400, body: { error: "merchant_order_id is required." } };
  }

  // Disconnected: no job row, no outbound call, nothing to clean up later.
  if (!req.enabled) return { status: 200, body: { skipped: "handoff_disabled" } };

  const facts = await deps.loadFacts(merchantOrderId);
  if (!facts) return { status: 404, body: { error: "Merchant order not found." } };
  if (facts.status !== "ready_for_pickup") return { status: 409, body: { error: "Order is not ready for pickup." } };

  const job = await deps.getOrCreateJob(merchantOrderId);
  if (job.dispatched_at) return { status: 200, body: { job_id: job.id, already_invoked: true } };

  const built = buildPayload(job.id, facts);
  if (!built.ok) {
    await deps.recordAttempt(job.id, { ok: false, error: built.error });
    return { status: 422, body: { job_id: job.id, error: built.error } };
  }

  const sent = await deps.send(built.payload);
  await deps.recordAttempt(job.id, sent);
  if (!sent.ok) return { status: 502, body: { job_id: job.id, error: sent.error } };
  return { status: 200, body: { job_id: job.id, invoked: true } };
}

/** Sends the payload to {baseUrl}/integrations/tolo-marketplace/delivery-jobs
 * with the shared key. Success is a 2xx with `{ "accepted": true }`. Errors are
 * short codes only: never a response body, the key or the payload. */
export async function sendToToloDelivery(
  payload: DeliveryJobPayload,
  config: { baseUrl: string | undefined; sharedKey: string | undefined },
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!config.baseUrl || !config.sharedKey) return { ok: false, error: "not_configured" };
  try {
    const res = await fetchImpl(`${config.baseUrl}/integrations/tolo-marketplace/delivery-jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.sharedKey}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, error: `tolo_http_${res.status}` };
    const body = await res.json().catch(() => null);
    return body?.accepted === true ? { ok: true } : { ok: false, error: "tolo_rejected" };
  } catch {
    return { ok: false, error: "tolo_unreachable" };
  }
}
