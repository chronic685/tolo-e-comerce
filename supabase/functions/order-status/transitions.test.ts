import { describe, expect, it } from "vitest";
import { customerMayMove, customerNotificationFor, isAcceptAndStart, merchantMayMove, MERCHANT_TRANSITIONS } from "./transitions.ts";

const STATUSES = ["new", "accepted", "rejected", "processing", "ready_for_pickup", "picked_up", "delivered", "completed", "cancelled"];

describe("merchant transitions", () => {
  it("are exactly the ones migration 0098 allows in the database", () => {
    const legal = new Set([
      "new>processing", "new>accepted", "new>rejected",
      "accepted>processing", "accepted>cancelled",
      "processing>ready_for_pickup", "processing>cancelled",
      "ready_for_pickup>picked_up", "ready_for_pickup>cancelled",
    ]);
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        expect(merchantMayMove(from, to), `${from} -> ${to}`).toBe(legal.has(`${from}>${to}`));
      }
    }
  });

  it("let a new order go straight to processing, the one-button accept", () => {
    expect(merchantMayMove("new", "processing")).toBe(true);
    expect(isAcceptAndStart("new", "processing")).toBe(true);
    expect(isAcceptAndStart("accepted", "processing")).toBe(false);
  });

  it("never let the merchant drive the delivery leg or go backwards", () => {
    for (const to of ["delivered", "completed", "new", "rejected"]) expect(merchantMayMove("ready_for_pickup", to)).toBe(false);
    expect(merchantMayMove("processing", "new")).toBe(false);
    expect(merchantMayMove("picked_up", "delivered")).toBe(false);
    expect(Object.keys(MERCHANT_TRANSITIONS)).not.toContain("picked_up");
  });
});

describe("customer transitions", () => {
  it("allow only cancelling, and only before the parcel is picked up", () => {
    for (const from of ["new", "accepted", "processing", "ready_for_pickup"]) expect(customerMayMove(from, "cancelled")).toBe(true);
    for (const from of ["picked_up", "delivered", "completed", "cancelled", "rejected"]) expect(customerMayMove(from, "cancelled")).toBe(false);
    expect(customerMayMove("new", "processing")).toBe(false);
  });
});

describe("customerNotificationFor", () => {
  it("sends one message for accept-and-start, not received then preparing", () => {
    expect(customerNotificationFor("new", "processing")).toBe("order_accepted_preparing");
  });

  it("keeps the two older messages for the older two-step path", () => {
    expect(customerNotificationFor("new", "accepted")).toBe("order_received");
    expect(customerNotificationFor("accepted", "processing")).toBe("order_preparing");
  });

  it("covers the rest of the happy path and the endings", () => {
    expect(customerNotificationFor("processing", "ready_for_pickup")).toBe("order_ready_for_pickup");
    expect(customerNotificationFor("ready_for_pickup", "picked_up")).toBe("order_picked_up");
    expect(customerNotificationFor("new", "rejected")).toBe("order_rejected");
    expect(customerNotificationFor("processing", "cancelled")).toBe("order_cancelled");
    expect(customerNotificationFor("picked_up", "delivered")).toBeNull();
  });
});
