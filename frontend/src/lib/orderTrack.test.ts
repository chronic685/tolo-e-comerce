import { describe, expect, it } from "vitest";
import { buildTrackSteps, getTrackIndex, statusBadgeVariant, trackSteps } from "./orderTrack";

// Echoes the key so the test reads the step, not the wording.
const t = (key: string) => key;

describe("the customer's order track", () => {
  it("has five steps, with Accepted and Preparing as ONE", () => {
    expect(trackSteps(t).map((s) => s.label)).toEqual([
      "trackStep.placed",
      "trackStep.preparing",
      "trackStep.ready",
      "trackStep.withDriver",
      "trackStep.delivered",
    ]);
  });

  it("puts both accepted and processing on the merged Preparing step", () => {
    expect(getTrackIndex("accepted")).toBe(1);
    expect(getTrackIndex("processing")).toBe(1);
    expect(getTrackIndex("new")).toBe(0);
  });

  it("separates Ready for pickup from With driver, then Delivered", () => {
    expect(getTrackIndex("ready_for_pickup")).toBe(2);
    expect(getTrackIndex("picked_up")).toBe(3);
    expect(getTrackIndex("delivered")).toBe(4);
    expect(getTrackIndex("completed")).toBe(4);
  });

  it("keeps cancelled and rejected off the track, as a state of their own", () => {
    expect(getTrackIndex("cancelled")).toBeNull();
    expect(getTrackIndex("rejected")).toBeNull();
    expect(statusBadgeVariant("cancelled")).toBe("danger");
  });
});

describe("buildTrackSteps", () => {
  const accepted = { status: "accepted", changed_at: "2026-10-01T10:00:00Z" };
  const processing = { status: "processing", changed_at: "2026-10-01T10:00:00Z" };

  it("shows the accept time as when preparing started, for an order moved in one tap", () => {
    const steps = buildTrackSteps([{ status: "new", changed_at: "2026-10-01T09:59:00Z" }, accepted, processing], 1, t);
    expect(steps[1].detail).toBeTruthy();
    expect(steps[1].detail).toBe(buildTrackSteps([accepted], 1, t)[1].detail);
    expect(steps[0].detail).toBeUndefined();
  });

  it("uses the EARLIEST of accepted and processing, even when processing came much later (an older two-step order)", () => {
    const later = { status: "processing", changed_at: "2026-10-01T10:30:00Z" };
    expect(buildTrackSteps([later, accepted], 1, t)[1].detail).toBe(buildTrackSteps([accepted], 1, t)[1].detail);
    expect(buildTrackSteps([later, accepted], 1, t)[1].detail).not.toBe(buildTrackSteps([later], 1, t)[1].detail);
  });

  it("renders an older order that is still in the accepted state under the merged step, with its time", () => {
    const steps = buildTrackSteps([accepted], getTrackIndex("accepted")!, t);
    expect(steps).toHaveLength(5);
    expect(steps[1].detail).toBeTruthy();
  });

  it("does not break an order with no matching history row", () => {
    const steps = buildTrackSteps([], 1, t);
    expect(steps).toHaveLength(5);
    expect(steps[1].detail).toBeUndefined();
  });

  it("works for every later step too", () => {
    const history = [accepted, processing, { status: "ready_for_pickup", changed_at: "2026-10-01T10:20:00Z" }, { status: "picked_up", changed_at: "2026-10-01T10:40:00Z" }];
    expect(buildTrackSteps(history, 2, t)[2].detail).toBeTruthy();
    expect(buildTrackSteps(history, 3, t)[3].detail).toBeTruthy();
  });
});
