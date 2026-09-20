import { beforeAll, describe, expect, inject, it } from "vitest";
import { env, serviceClient, signIn } from "../env.ts";
import { callFunction } from "../helpers.ts";

// Phase 5d, item 6: settlement-run only ever summed merchant_orders.merchant_payable,
// silently ignoring any financial_adjustments (bonus/penalty/correction/etc.
// from the admin Settlements page) recorded for the merchant. It now nets
// every not-yet-consumed adjustment (financial_adjustments.settlement_id is
// null) into the payout and stamps settlement_id so a later run never
// re-applies the same adjustment twice.
//
// Uses a period far in the future so no real/other-test merchant_orders can
// ever fall inside it — isolates the adjustment-only path (item_count must
// be 0) from the pre-existing order-summing behavior, which is unchanged.
const db = serviceClient();
const FUTURE_PERIOD_START = "2099-01-01";
const FUTURE_PERIOD_END = "2099-01-31";

async function walletBalance(merchantId: string): Promise<number> {
  const { data } = await db.from("merchant_wallets").select("balance").eq("merchant_id", merchantId).maybeSingle();
  return data ? Number(data.balance) : 0;
}

describe("settlement-run: netting unsettled financial_adjustments", () => {
  let staffToken: string;

  beforeAll(async () => {
    staffToken = await signIn(env.qaStaffEmail, env.qaStaffPassword);
  });

  it("nets an unsettled adjustment into the total and marks it consumed, even with no eligible orders in the period", async () => {
    const fixtures = inject("qaFixtures");
    const balanceBefore = await walletBalance(fixtures.merchantAId);

    const { data: adjustment, error: adjError } = await db
      .from("financial_adjustments")
      .insert({ merchant_id: fixtures.merchantAId, type: "bonus", amount: 37.5, reason: "QA TEST — Phase 5d settlement netting" })
      .select("id")
      .single();
    expect(adjError).toBeNull();

    const res = await callFunction("settlement-run", {
      token: staffToken,
      body: { merchant_id: fixtures.merchantAId, period_start: FUTURE_PERIOD_START, period_end: FUTURE_PERIOD_END },
    });
    expect(res.status).toBe(200);
    const body = res.json as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.item_count).toBe(0);
    expect(body.adjustments_netted).toBe(1);
    expect(Number(body.total_amount)).toBe(37.5);

    const { data: consumedAdjustment, error: fetchError } = await db
      .from("financial_adjustments")
      .select("settlement_id")
      .eq("id", adjustment!.id)
      .single();
    expect(fetchError).toBeNull();
    expect(consumedAdjustment!.settlement_id).toBe(body.settlement_id);

    // The wallet debit itself must reflect the netted total, not just the orders sum.
    expect(await walletBalance(fixtures.merchantAId)).toBe(balanceBefore - 37.5);
  });

  it("does not re-apply an adjustment already consumed by a previous settlement", async () => {
    const fixtures = inject("qaFixtures");

    const { data: adjustment, error: adjError } = await db
      .from("financial_adjustments")
      .insert({ merchant_id: fixtures.merchantAId, type: "penalty", amount: -10, reason: "QA TEST — Phase 5d settlement double-apply guard" })
      .select("id")
      .single();
    expect(adjError).toBeNull();

    const firstRun = await callFunction("settlement-run", {
      token: staffToken,
      body: { merchant_id: fixtures.merchantAId, period_start: FUTURE_PERIOD_START, period_end: FUTURE_PERIOD_END },
    });
    expect(firstRun.status).toBe(200);
    const firstBody = firstRun.json as Record<string, unknown>;
    expect(firstBody.adjustments_netted).toBe(1);
    expect(Number(firstBody.total_amount)).toBe(-10);

    // A second run for the same merchant/period must find nothing left —
    // the adjustment is now consumed and there are still no eligible orders.
    const secondRun = await callFunction("settlement-run", {
      token: staffToken,
      body: { merchant_id: fixtures.merchantAId, period_start: FUTURE_PERIOD_START, period_end: FUTURE_PERIOD_END },
    });
    expect(secondRun.status).toBe(200);
    const secondBody = secondRun.json as Record<string, unknown>;
    expect(secondBody.message).toBe("Nothing to settle for this period");

    const { data: consumedAdjustment } = await db.from("financial_adjustments").select("settlement_id").eq("id", adjustment!.id).single();
    expect(consumedAdjustment!.settlement_id).toBe(firstBody.settlement_id);
  });
});
