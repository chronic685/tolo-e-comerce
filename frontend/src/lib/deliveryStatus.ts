// Maps a delivery job (delivery_jobs, migration 0080) onto what the order
// tracking page tells the customer. Only the status data the Tolo Delivery
// app actually reports: no live location, and no "out for delivery" stage
// distinct from "picked up" because the app doesn't report one.

export interface DeliveryJobView {
  status: "invoked" | "accepted" | "picked_up" | "delivered" | "failed" | "cancelled";
  eta_at: string | null;
}

export type DeliveryStage = "finding" | "assigned" | "picked_up" | "delivered" | "problem";

const STAGES: Record<DeliveryJobView["status"], DeliveryStage> = {
  invoked: "finding",
  accepted: "assigned",
  picked_up: "picked_up",
  delivered: "delivered",
  failed: "problem",
  // Never shown: deliveryStageFor() returns null for a cancelled job.
  cancelled: "problem",
};

/** PostgREST embeds a one-to-one relation as an object, but tolerate a
 * one-element array so a schema change can't blank the card. */
export function pickDeliveryJob(embedded: DeliveryJobView | DeliveryJobView[] | null | undefined): DeliveryJobView | null {
  return (Array.isArray(embedded) ? embedded[0] : embedded) ?? null;
}

/** The stage to show for a merchant order, or null when there's nothing to
 * say: no job yet, or the order was cancelled/rejected so a delivery status
 * would only confuse. */
export function deliveryStageFor(job: DeliveryJobView | null, orderStatus: string): DeliveryStage | null {
  if (!job || job.status === "cancelled" || orderStatus === "cancelled" || orderStatus === "rejected") return null;
  return STAGES[job.status] ?? null;
}

/** The ETA worth showing: only while a driver is on the job, and only if it's still ahead. */
export function visibleEta(job: DeliveryJobView, now: Date = new Date()): string | null {
  if (job.status !== "accepted" && job.status !== "picked_up") return null;
  if (!job.eta_at || new Date(job.eta_at).getTime() <= now.getTime()) return null;
  return job.eta_at;
}

/** Order statuses a customer may cancel from: everything from placement up to
 * (not including) the driver picking the parcel up. Mirrors CUSTOMER_TRANSITIONS
 * in the order-status Edge Function, which is what actually enforces it. */
const CUSTOMER_CANCELLABLE = new Set(["new", "accepted", "processing", "ready_for_pickup"]);

/** Whether to offer "Cancel order": a cancellable status, and no delivery job
 * that has already been picked up (it can lead the order status by a moment). */
export function canCustomerCancel(orderStatus: string, job: DeliveryJobView | null): boolean {
  if (!CUSTOMER_CANCELLABLE.has(orderStatus)) return false;
  return !job || (job.status !== "picked_up" && job.status !== "delivered");
}
