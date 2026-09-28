// Visual progress-tracker mapping for merchant_order.status, built ALONGSIDE
// the existing STATUS_COPY (orderStatus.ts) rather than replacing it — this
// file only decides how status maps onto the Stepper/Badge components, it
// doesn't own any customer-facing copy itself.
import type { StepperStep } from "@tolo/ui";
import { formatDateTime } from "@tolo/ui";

// Collapses ready_for_pickup + picked_up into a single "On the way" step, as
// specced: placed -> accepted -> preparing -> on the way -> delivered.
export const TRACK_STEPS: StepperStep[] = [
  { key: "new", label: "Placed" },
  { key: "accepted", label: "Accepted" },
  { key: "processing", label: "Preparing" },
  { key: "on_the_way", label: "On the way" },
  { key: "delivered", label: "Delivered" },
];

// Which real merchant_order_status value(s) correspond to each TRACK_STEPS
// entry, in order. Used both for the currentIndex lookup and for finding a
// step's real timestamp in order_status_history.
const TRACK_STATUS_GROUPS: string[][] = [
  ["new"],
  ["accepted"],
  ["processing"],
  ["ready_for_pickup", "picked_up"],
  ["delivered", "completed"],
];

const TRACK_INDEX: Record<string, number> = {};
TRACK_STATUS_GROUPS.forEach((group, i) => group.forEach((status) => (TRACK_INDEX[status] = i)));

/** Terminal/branch statuses that never sit on the linear happy-path track. */
export const TERMINAL_STATUSES = new Set(["cancelled", "rejected"]);

/** Index into TRACK_STEPS for a merchant_order status, or null for a
 * terminal/branch status (cancelled, rejected) that isn't on the track. */
export function getTrackIndex(status: string): number | null {
  return status in TRACK_INDEX ? TRACK_INDEX[status] : null;
}

/** Badge color variant for a status — used for the dense list view (Orders.tsx)
 * where a full Stepper would be too tight. */
export function statusBadgeVariant(status: string): "default" | "info" | "success" | "danger" {
  if (status === "cancelled" || status === "rejected") return "danger";
  if (status === "delivered" || status === "completed") return "success";
  if (status === "new") return "default";
  return "info"; // accepted, processing, ready_for_pickup, picked_up
}

/** Builds the TRACK_STEPS array with a real timestamp (from the order's own
 * order_status_history — no new query) attached to the currently-active
 * step's `detail`, e.g. "Sep 26, 2026, 6:43 PM". Falls back to the plain
 * steps if no matching history row is found. */
export function buildTrackSteps(
  history: { status: string; changed_at: string }[],
  currentIndex: number,
): StepperStep[] {
  const candidates = TRACK_STATUS_GROUPS[currentIndex];
  if (!candidates) return TRACK_STEPS;
  const matches = history
    .filter((h) => candidates.includes(h.status))
    .sort((a, b) => new Date(a.changed_at).getTime() - new Date(b.changed_at).getTime());
  const reachedAt = matches[0]?.changed_at;
  if (!reachedAt) return TRACK_STEPS;
  return TRACK_STEPS.map((step, i) => (i === currentIndex ? { ...step, detail: formatDateTime(reachedAt) } : step));
}
