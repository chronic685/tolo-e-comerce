import { describe, expect, inject, it } from "vitest";

describe("QA fixture setup", () => {
  it("provisions QA merchant A, merchant B, customer, and a fixture order", () => {
    const fixtures = inject("qaFixtures");
    expect(fixtures.merchantAId).toBeTruthy();
    expect(fixtures.merchantBId).toBeTruthy();
    expect(fixtures.merchantAId).not.toBe(fixtures.merchantBId);
    expect(fixtures.merchantOrderId).toBeTruthy();
    expect(fixtures.paymentId).toBeTruthy();
  });
});
