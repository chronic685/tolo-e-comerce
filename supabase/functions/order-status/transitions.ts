// The order status rules, free of Deno/network/database code so they run under plain Vitest (same split as
// delivery-handoff/logic.ts). index.ts applies them; migration 0098 enforces the same transitions in the database for every
// client write, so the two must say the same thing (supabase/tests/order_flow_transitions.test.ts checks the SQL side).

/** What the merchant's own staff may move an order to, from each status. */
export const MERCHANT_TRANSITIONS: Record<string, string[]> = {
  // "processing" is the one-button path (accept and start preparing in one step). "accepted" is the older two-step path,
  // still accepted from existing clients and still how older orders sit.
  new: ["processing", "accepted", "rejected"],
  accepted: ["processing", "cancelled"],
  processing: ["ready_for_pickup", "cancelled"],
  // Handed to the driver (or collected by the customer). Everything after is driven by the driver and the delivery handoff.
  ready_for_pickup: ["picked_up", "cancelled"],
};

/** The only customer-initiated move: cancel, from placement until the driver has accepted the job. */
export const CUSTOMER_TRANSITIONS: Record<string, string[]> = {
  new: ["cancelled"],
  accepted: ["cancelled"],
  processing: ["cancelled"],
  ready_for_pickup: ["cancelled"],
};

/** Order statuses at which a driver is assigned or the parcel is beyond that, so cancelling is closed. */
export const WITH_DRIVER_ORDER_STATUSES = ["picked_up", "delivered", "completed"];
/** Delivery job statuses at which the same is true. (A "failed" job never reached a driver's hands, and "cancelled" is ours.) */
export const WITH_DRIVER_JOB_STATUSES = ["accepted", "picked_up", "delivered"];

export function merchantMayMove(from: string, to: string): boolean {
  return (MERCHANT_TRANSITIONS[from] ?? []).includes(to);
}

export function customerMayMove(from: string, to: string): boolean {
  return (CUSTOMER_TRANSITIONS[from] ?? []).includes(to);
}

/** Accepting and starting to prepare in one move. */
export function isAcceptAndStart(from: string, to: string): boolean {
  return from === "new" && to === "processing";
}

/**
 * Which customer notification a move sends. The one-button accept sends ONE message ("accepted and being prepared"),
 * not "received" followed by "preparing" seconds later; the older two-step path keeps its two messages, one per step.
 */
export function customerNotificationFor(from: string, to: string): string | null {
  if (isAcceptAndStart(from, to)) return "order_accepted_preparing";
  switch (to) {
    case "accepted":
      return "order_received";
    case "processing":
      return "order_preparing";
    case "ready_for_pickup":
      return "order_ready_for_pickup";
    case "picked_up":
      return "order_picked_up";
    case "rejected":
      return "order_rejected";
    case "cancelled":
      return "order_cancelled";
    default:
      return null;
  }
}
