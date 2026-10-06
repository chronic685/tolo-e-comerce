import { describe, expect, it } from "vitest";
import { nextStep, reasonNote, rejectStep } from "./orderFlow";

describe("nextStep: the one primary button", () => {
  it("accepts and starts preparing from a new order, straight to processing", () => {
    expect(nextStep("new")).toEqual({ to: "processing", labelKey: "merchant.acceptAndStart" });
  });

  it("offers Ready for pickup while preparing", () => {
    expect(nextStep("processing")).toEqual({ to: "ready_for_pickup", labelKey: "merchant.markReady" });
  });

  it("offers Handed to driver when ready, or Picked up by customer for a self-pickup order", () => {
    expect(nextStep("ready_for_pickup")).toEqual({ to: "picked_up", labelKey: "merchant.handedToDriver" });
    expect(nextStep("ready_for_pickup", { selfPickup: true })).toEqual({ to: "picked_up", labelKey: "merchant.pickedUpByCustomer" });
  });

  it("lets an older order in the accepted state carry on to preparing", () => {
    expect(nextStep("accepted")).toEqual({ to: "processing", labelKey: "merchant.startPreparing" });
  });

  it("gives the merchant nothing for the steps the driver and the delivery handoff drive", () => {
    for (const status of ["picked_up", "delivered", "completed", "cancelled", "rejected"]) expect(nextStep(status)).toBeNull();
  });
});

describe("rejectStep: the secondary action", () => {
  it("rejects a new order and cancels one that is accepted, being prepared or ready", () => {
    expect(rejectStep("new")?.to).toBe("rejected");
    for (const status of ["accepted", "processing", "ready_for_pickup"]) expect(rejectStep(status)?.to).toBe("cancelled");
  });

  it("is gone once the order is with the driver or finished", () => {
    for (const status of ["picked_up", "delivered", "completed", "cancelled", "rejected"]) expect(rejectStep(status)).toBeNull();
  });
});

describe("reasonNote", () => {
  it("stores the English reason, with the merchant's detail after it", () => {
    expect(reasonNote("out_of_stock", "")).toBe("Out of stock");
    expect(reasonNote("too_busy", "  kitchen is full ")).toBe("Too busy right now: kitchen is full");
    expect(reasonNote("unknown", "just text")).toBe("just text");
    expect(reasonNote("unknown", "")).toBeUndefined();
  });
});
