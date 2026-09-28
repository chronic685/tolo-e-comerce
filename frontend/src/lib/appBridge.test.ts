import { beforeEach, describe, expect, it } from "vitest";
import { buildAppUrl, closeApp, initEmbedMode, isEmbedMode, notifyOrderPlaced, openPayment } from "./appBridge";

function mockLocation(search: string) {
  Object.defineProperty(window, "location", {
    value: { search, href: "" },
    writable: true,
    configurable: true,
  });
}

describe("buildAppUrl", () => {
  it("builds a bare event URL with no params", () => {
    expect(buildAppUrl("close")).toBe("toloapp://close");
  });

  it("builds an event URL with one param", () => {
    expect(buildAppUrl("order-placed", { orderId: "abc123" })).toBe("toloapp://order-placed?orderId=abc123");
  });

  it("supports multiple params", () => {
    const url = buildAppUrl("open-payment", { orderId: "abc123", amount: "1050" });
    expect(url).toBe("toloapp://open-payment?orderId=abc123&amount=1050");
  });
});

describe("embed mode detection", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("is not embed mode by default", () => {
    mockLocation("");
    initEmbedMode();
    expect(isEmbedMode()).toBe(false);
  });

  it("detects ?embed=app and persists it", () => {
    mockLocation("?embed=app");
    initEmbedMode();
    expect(isEmbedMode()).toBe(true);
  });

  it("stays true after the param is gone from the URL (session persistence)", () => {
    mockLocation("?embed=app");
    initEmbedMode();
    expect(isEmbedMode()).toBe(true);

    // Simulates in-app navigation to a link that dropped the query param —
    // re-running init (e.g. on route change) must not clear the flag.
    mockLocation("");
    initEmbedMode();
    expect(isEmbedMode()).toBe(true);
  });

  it("ignores unrelated embed values", () => {
    mockLocation("?embed=web");
    initEmbedMode();
    expect(isEmbedMode()).toBe(false);
  });
});

describe("app bridge events", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("does nothing when not in embed mode", () => {
    mockLocation("");
    closeApp();
    expect(window.location.href).toBe("");
  });

  it("does not fire order-placed outside embed mode", () => {
    mockLocation("");
    notifyOrderPlaced("order-42");
    expect(window.location.href).toBe("");
  });

  it("does not fire open-payment outside embed mode", () => {
    mockLocation("");
    openPayment("order-42", 1050);
    expect(window.location.href).toBe("");
  });

  it("navigates to toloapp://close when in embed mode", () => {
    mockLocation("?embed=app");
    initEmbedMode();
    closeApp();
    expect(window.location.href).toBe("toloapp://close");
  });

  it("navigates to toloapp://order-placed with the order id", () => {
    mockLocation("?embed=app");
    initEmbedMode();
    notifyOrderPlaced("order-42");
    expect(window.location.href).toBe("toloapp://order-placed?orderId=order-42");
  });

  it("navigates to toloapp://open-payment with order id and amount", () => {
    mockLocation("?embed=app");
    initEmbedMode();
    openPayment("order-42", 1050);
    expect(window.location.href).toBe("toloapp://open-payment?orderId=order-42&amount=1050");
  });
});
