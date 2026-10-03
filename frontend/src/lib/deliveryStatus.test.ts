import { describe, expect, it } from "vitest";
import { deliveryStageFor, pickDeliveryJob, visibleEta, type DeliveryJobView } from "./deliveryStatus";

const job = (status: DeliveryJobView["status"], eta_at: string | null = null): DeliveryJobView => ({ status, eta_at });

describe("deliveryStageFor", () => {
  it("maps each job status to a customer-facing stage", () => {
    expect(deliveryStageFor(job("invoked"), "ready_for_pickup")).toBe("finding");
    expect(deliveryStageFor(job("accepted"), "ready_for_pickup")).toBe("assigned");
    expect(deliveryStageFor(job("picked_up"), "picked_up")).toBe("picked_up");
    expect(deliveryStageFor(job("delivered"), "completed")).toBe("delivered");
    expect(deliveryStageFor(job("failed"), "ready_for_pickup")).toBe("problem");
  });

  it("says nothing without a job, or for a cancelled/rejected order", () => {
    expect(deliveryStageFor(null, "ready_for_pickup")).toBeNull();
    expect(deliveryStageFor(job("accepted"), "cancelled")).toBeNull();
    expect(deliveryStageFor(job("invoked"), "rejected")).toBeNull();
  });
});

describe("pickDeliveryJob", () => {
  it("accepts an embedded object, a one-element array, or nothing", () => {
    expect(pickDeliveryJob(job("accepted"))).toEqual(job("accepted"));
    expect(pickDeliveryJob([job("accepted")])).toEqual(job("accepted"));
    expect(pickDeliveryJob([])).toBeNull();
    expect(pickDeliveryJob(null)).toBeNull();
    expect(pickDeliveryJob(undefined)).toBeNull();
  });
});

describe("visibleEta", () => {
  const now = new Date("2026-10-03T10:00:00Z");
  it("shows a future ETA while a driver is on the job", () => {
    expect(visibleEta(job("accepted", "2026-10-03T10:20:00Z"), now)).toBe("2026-10-03T10:20:00Z");
    expect(visibleEta(job("picked_up", "2026-10-03T10:20:00Z"), now)).toBe("2026-10-03T10:20:00Z");
  });
  it("hides a missing or already-passed ETA, and any ETA outside those statuses", () => {
    expect(visibleEta(job("accepted"), now)).toBeNull();
    expect(visibleEta(job("accepted", "2026-10-03T09:00:00Z"), now)).toBeNull();
    expect(visibleEta(job("invoked", "2026-10-03T10:20:00Z"), now)).toBeNull();
    expect(visibleEta(job("delivered", "2026-10-03T10:20:00Z"), now)).toBeNull();
  });
});
