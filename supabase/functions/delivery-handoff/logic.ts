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
  /** This job's share of orders.delivery_fee (see attributeOrderLevelCharges). */
  deliveryFee: number;
  /** This job's share of orders.rider_tip. */
  riderTip: number;
  items: { name: string; quantity: number }[];
  pickup: { name: string | null; address: string | null; latitude: number | null; longitude: number | null; phone: string | null };
  dropoff: {
    name: string | null;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
    /** The phone linked to the customer's Tolo session (tolo_phone_links), if any. The only
     * phone ever sent to a driver: the address's own phone is self-entered and unverified. */
    verifiedPhone: string | null;
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
    /** The customer's Tolo-verified phone. */
    phone: string;
  };
  items: { name: string; quantity: number }[];
  // Components only. The marketplace deliberately does not add these up: the
  // Tolo Delivery app computes what the driver sees from them.
  amounts: { currency: "ETB"; item_subtotal: number; discount: number; delivery_fee: number; rider_tip: number };
  payment: { method: PaymentMethod; driver_collects_cash: boolean };
}

export type BuildResult = { ok: true; payload: DeliveryJobPayload } | { ok: false; error: string };

/** Splits `totalCents` across `weights` proportionally. Cents left over by
 * rounding go one each to the earliest entries, so the shares always add up to
 * exactly `totalCents`. All-zero weights split evenly. */
function splitCents(totalCents: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const w = sum > 0 ? weights : weights.map(() => 1);
  const wSum = w.reduce((a, b) => a + b, 0);
  const shares = w.map((x) => Math.floor((totalCents * x) / wSum));
  let left = totalCents - shares.reduce((a, b) => a + b, 0);
  for (let i = 0; left > 0; i = (i + 1) % shares.length, left--) shares[i] += 1;
  return shares;
}

const toCents = (n: number) => Math.round(n * 100);

/** A multi-merchant checkout has one delivery fee and one rider tip for the
 * whole order but one job (one driver) per merchant. Each job carries a share
 * of both, split in proportion to its merchant order's item subtotal, so the
 * jobs' shares add up to exactly what the customer was charged. `siblings` is
 * every merchant order on the order that is still going ahead (not rejected or
 * cancelled), in creation order then id, and must include this one. */
export function attributeOrderLevelCharges(
  merchantOrderId: string,
  siblings: { id: string; subtotal: number }[],
  orderCharges: { deliveryFee: number; riderTip: number },
): { deliveryFee: number; riderTip: number } {
  const i = siblings.findIndex((s) => s.id === merchantOrderId);
  if (i < 0) throw new Error("merchant order missing from its siblings");
  const weights = siblings.map((s) => toCents(s.subtotal));
  return {
    deliveryFee: splitCents(toCents(orderCharges.deliveryFee), weights)[i] / 100,
    riderTip: splitCents(toCents(orderCharges.riderTip), weights)[i] / 100,
  };
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

  // Never fall back to the address's own phone: it's whatever the customer typed.
  const dropoffPhone = facts.dropoff.verifiedPhone;
  if (!dropoffPhone) return { ok: false, error: "no_verified_phone" };
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
  /** Records one handoff attempt: acknowledged, or why not. Counts it.
   * `manual` marks a failure retrying can't fix (the order itself is unsendable),
   * so an admin has to deal with it. */
  recordAttempt(jobId: string, outcome: { ok: true } | { ok: false; error: string; manual?: boolean }): Promise<void>;
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
    await deps.recordAttempt(job.id, { ok: false, error: built.error, manual: true });
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
