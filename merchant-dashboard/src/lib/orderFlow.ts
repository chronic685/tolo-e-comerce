import { supabase } from "./supabase";
import { extractServerErrorText } from "@tolo/ui";

// One primary button per order. Which button, and what a reject / cancel means, depends only on the order's status;
// the order-status Edge Function (and migration 0098 in the database) enforce the same steps, so this file never
// decides what is allowed, it only decides what to offer.

export interface NextStep {
  /** The status the button moves the order to. */
  to: string;
  /** Translation key for the button label. */
  labelKey: string;
}

/**
 * The single primary action for an order, or null when the merchant has nothing to do:
 *   new               -> accept and start preparing (one step, straight to "processing")
 *   processing        -> ready for pickup
 *   ready for pickup  -> handed to the driver (or, for a self-pickup order, picked up by the customer)
 *   everything later is driven by the driver and the delivery handoff.
 * "accepted" is the older two-step state some orders still sit in; it offers "start preparing" so they can move on.
 * Self-pickup is a parameter because orders carry no pickup option yet: callers pass false until one exists.
 */
export function nextStep(status: string, options: { selfPickup?: boolean } = {}): NextStep | null {
  switch (status) {
    case "new":
      return { to: "processing", labelKey: "merchant.acceptAndStart" };
    case "accepted":
      return { to: "processing", labelKey: "merchant.startPreparing" };
    case "processing":
      return { to: "ready_for_pickup", labelKey: "merchant.markReady" };
    case "ready_for_pickup":
      return { to: "picked_up", labelKey: options.selfPickup ? "merchant.pickedUpByCustomer" : "merchant.handedToDriver" };
    default:
      return null;
  }
}

export interface RejectStep {
  to: "rejected" | "cancelled";
  labelKey: string;
  confirmKey: string;
}

/** The secondary action: reject a new order, cancel one already being prepared or ready. Nothing once it is with the driver. */
export function rejectStep(status: string): RejectStep | null {
  if (status === "new") return { to: "rejected", labelKey: "merchant.rejectOrCancel", confirmKey: "merchant.rejectOrder" };
  if (["accepted", "processing", "ready_for_pickup"].includes(status)) {
    return { to: "cancelled", labelKey: "merchant.rejectOrCancel", confirmKey: "orders.cancelOrder" };
  }
  return null;
}

/** Reasons offered when rejecting or cancelling. The stored note is the English text, so the history reads the same everywhere. */
export const REJECT_REASONS: { key: string; labelKey: string; note: string }[] = [
  { key: "out_of_stock", labelKey: "merchant.reason.outOfStock", note: "Out of stock" },
  { key: "too_busy", labelKey: "merchant.reason.tooBusy", note: "Too busy right now" },
  { key: "cannot_prepare", labelKey: "merchant.reason.cannotPrepare", note: "Cannot prepare this order" },
  { key: "closing", labelKey: "merchant.reason.closing", note: "Closing early" },
  { key: "customer_request", labelKey: "merchant.reason.customerRequest", note: "Customer asked to cancel" },
  { key: "other", labelKey: "merchant.reason.other", note: "Other" },
];

export function reasonNote(reasonKey: string, detail: string): string | undefined {
  const reason = REJECT_REASONS.find((r) => r.key === reasonKey);
  const text = detail.trim();
  if (!reason) return text || undefined;
  return text ? `${reason.note}: ${text}` : reason.note;
}

export type AdvanceResult = { ok: true; unchanged: boolean } | { ok: false; error: string };

/** Moves one order. Safe to call twice: the function answers "unchanged" when the order is already there. */
export async function advanceOrder(merchantOrderId: string, to: string, note?: string): Promise<AdvanceResult> {
  const { data, error } = await supabase.functions.invoke("order-status", { body: { merchant_order_id: merchantOrderId, status: to, note } });
  if (error) return { ok: false, error: (await extractServerErrorText(error)) ?? "" };
  return { ok: true, unchanged: Boolean((data as { unchanged?: boolean } | null)?.unchanged) };
}
