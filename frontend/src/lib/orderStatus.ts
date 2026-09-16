// Customer-facing copy (spec: order status should read as reassurance, not
// raw internal state names).
export const STATUS_COPY: Record<string, { label: string; detail: string }> = {
  new: { label: "Order placed", detail: "Waiting for the merchant to confirm your order." },
  accepted: { label: "Order confirmed", detail: "The merchant has received your order and is preparing it." },
  processing: { label: "Preparing your order", detail: "Your order is being prepared." },
  ready_for_pickup: { label: "Ready for pickup", detail: "Your order is ready and waiting for a Tolo driver." },
  picked_up: { label: "Driver assigned", detail: "A Tolo driver has picked up your order." },
  delivered: { label: "Delivered", detail: "Your order has been delivered." },
  completed: { label: "Completed", detail: "This order is complete." },
  cancelled: { label: "Cancelled", detail: "This order was cancelled." },
  rejected: { label: "Rejected", detail: "The merchant was unable to fulfill this order." },
};
