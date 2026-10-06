// Visual progress-tracker mapping for merchant_order.status, built ALONGSIDE
// the existing STATUS_COPY (orderStatus.ts) — this file only decides how
// status maps onto the Stepper/Badge components; the labels are translation keys.
import type { StepperStep } from "@tolo/ui";
import { formatDateTime } from "@tolo/ui";

type T = (key: string, vars?: Record<string, string | number>) => string;

// What the customer sees: Placed -> Preparing your order -> Ready for pickup -> With driver -> Delivered.
// "Accepted" and "Preparing" are ONE step: the merchant accepts and starts preparing in a single tap, so there is no
// moment worth showing between them. Orders that sit in the older "accepted" state render under the same step.
export const TRACK_STEP_KEYS: { key: string; labelKey: string }[] = [
  { key: "new", labelKey: "trackStep.placed" },
  { key: "preparing", labelKey: "trackStep.preparing" },
  { key: "ready_for_pickup", labelKey: "trackStep.ready" },
  { key: "with_driver", labelKey: "trackStep.withDriver" },
  { key: "delivered", labelKey: "trackStep.delivered" },
];

// Which real merchant_order_status value(s) correspond to each step, in order. Used both for the currentIndex lookup and
// for finding a step's real timestamp in order_status_history. The old status values stay in the database (and in the
// delivery handoff), so both "accepted" and "processing" map to the merged step.
const TRACK_STATUS_GROUPS: string[][] = [
  ["new"],
  ["accepted", "processing"],
  ["ready_for_pickup"],
  ["picked_up"],
  ["delivered", "completed"],
];

const TRACK_INDEX: Record<string, number> = {};
TRACK_STATUS_GROUPS.forEach((group, i) => group.forEach((status) => (TRACK_INDEX[status] = i)));

/** Terminal/branch statuses that never sit on the linear happy-path track. */
export const TERMINAL_STATUSES = new Set(["cancelled", "rejected"]);

/** Index into the steps for a merchant_order status, or null for a terminal/branch status (cancelled, rejected)
 * that isn't on the track. */
export function getTrackIndex(status: string): number | null {
  return status in TRACK_INDEX ? TRACK_INDEX[status] : null;
}

/** The steps with their translated labels and no timestamps. */
export function trackSteps(t: T): StepperStep[] {
  return TRACK_STEP_KEYS.map((step) => ({ key: step.key, label: t(step.labelKey) }));
}

/** Badge color variant for a status — used for the dense list view (Orders.tsx)
 * where a full Stepper would be too tight. */
export function statusBadgeVariant(status: string): "default" | "info" | "success" | "danger" {
  if (status === "cancelled" || status === "rejected") return "danger";
  if (status === "delivered" || status === "completed") return "success";
  if (status === "new") return "default";
  return "info"; // accepted, processing, ready_for_pickup, picked_up
}

/** The steps with a real timestamp (from the order's own order_status_history, no new query) on the currently-active step.
 * For the merged step that is the EARLIEST of its accepted / processing rows: when the merchant accepted and started, not
 * when a later retry or correction happened. Falls back to the plain steps if no matching history row is found. */
export function buildTrackSteps(history: { status: string; changed_at: string }[], currentIndex: number, t: T): StepperStep[] {
  const steps = trackSteps(t);
  const candidates = TRACK_STATUS_GROUPS[currentIndex];
  if (!candidates) return steps;
  const matches = history
    .filter((h) => candidates.includes(h.status))
    .sort((a, b) => new Date(a.changed_at).getTime() - new Date(b.changed_at).getTime());
  const reachedAt = matches[0]?.changed_at;
  if (!reachedAt) return steps;
  return steps.map((step, i) => (i === currentIndex ? { ...step, detail: formatDateTime(reachedAt) } : step));
}
