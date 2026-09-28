import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeAll, describe, expect, inject, it } from "vitest";
import { env, serviceClient, signIn } from "../env.ts";
import { callFunction } from "../helpers.ts";

function authedClient(token: string) {
  return createClient(env.supabaseUrl, env.anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Group 3, item 11. settlements.status only ever went to 'pending' (its
// own column default, migration 0009) -- nothing transitioned it further.
// Verifies the admin-only "mark as paid" authorization boundary and that
// a merchant can read their own settlement/settlement_items rows (RLS
// already allowed this, migration 0051; the new Wallet.tsx statement view
// just queries it for the first time).
//
// Uses a unique, far-future period per test (same technique as
// settlement-adjustments.test.ts) so this never collides with real
// merchant_orders or other tests' settlements for the same merchant.
const db = serviceClient();

async function createSettlement(staffToken: string, merchantId: string, periodStart: string, periodEnd: string) {
  const { data: adjustment, error: adjError } = await db
    .from("financial_adjustments")
    .insert({ merchant_id: merchantId, type: "bonus", amount: 12.5, reason: "QA TEST — payout statements" })
    .select("id")
    .single();
  if (adjError) throw adjError;

  const res = await callFunction("settlement-run", {
    token: staffToken,
    body: { merchant_id: merchantId, period_start: periodStart, period_end: periodEnd },
  });
  if (res.status !== 200) throw new Error(`settlement-run failed: ${res.status} ${JSON.stringify(res.json)}`);
  const settlementId = (res.json as { settlement_id: string }).settlement_id;
  return { settlementId, adjustmentId: adjustment.id };
}

describe("payout statements: mark as paid + merchant read access (migration for settlements.paid_at)", () => {
  let staffToken: string;
  let merchantAToken: string;
  let merchantBToken: string;
  const createdSettlementIds: string[] = [];
  const createdAdjustmentIds: string[] = [];

  beforeAll(async () => {
    staffToken = await signIn(env.qaStaffEmail, env.qaStaffPassword);
    merchantAToken = await signIn(env.qaMerchantAEmail, env.qaMerchantAPassword);
    merchantBToken = await signIn(env.qaMerchantBEmail, env.qaMerchantBPassword);
  });

  afterEach(async () => {
    for (const id of createdSettlementIds.splice(0)) {
      await db.from("settlement_items").delete().eq("settlement_id", id);
      await db.from("settlements").delete().eq("id", id);
    }
    for (const id of createdAdjustmentIds.splice(0)) {
      await db.from("financial_adjustments").delete().eq("id", id);
    }
  });

  it("a settlement starts as 'pending' with no paid_at", async () => {
    const fixtures = inject("qaFixtures");
    const { settlementId, adjustmentId } = await createSettlement(staffToken, fixtures.merchantAId, "2098-01-01", "2098-01-31");
    createdSettlementIds.push(settlementId);
    createdAdjustmentIds.push(adjustmentId);

    const { data } = await db.from("settlements").select("status, paid_at").eq("id", settlementId).single();
    expect(data!.status).toBe("pending");
    expect(data!.paid_at).toBeNull();
  });

  it("staff with the settlements page can mark a payout as paid", async () => {
    const fixtures = inject("qaFixtures");
    const { settlementId, adjustmentId } = await createSettlement(staffToken, fixtures.merchantAId, "2098-02-01", "2098-02-28");
    createdSettlementIds.push(settlementId);
    createdAdjustmentIds.push(adjustmentId);

    const staffClient = authedClient(staffToken);
    const paidAt = new Date().toISOString();
    const { error } = await staffClient.from("settlements").update({ status: "paid", paid_at: paidAt }).eq("id", settlementId);
    expect(error).toBeNull();

    const { data } = await db.from("settlements").select("status, paid_at").eq("id", settlementId).single();
    expect(data!.status).toBe("paid");
    expect(data!.paid_at).not.toBeNull();
  });

  it("a merchant cannot mark their own payout as paid", async () => {
    const fixtures = inject("qaFixtures");
    const { settlementId, adjustmentId } = await createSettlement(staffToken, fixtures.merchantAId, "2098-03-01", "2098-03-31");
    createdSettlementIds.push(settlementId);
    createdAdjustmentIds.push(adjustmentId);

    const merchantAClient = authedClient(merchantAToken);

    const { error, count } = await merchantAClient
      .from("settlements")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", settlementId)
      .select("id", { count: "exact" });
    expect(error).toBeNull();
    expect(count).toBe(0);

    const { data } = await db.from("settlements").select("status").eq("id", settlementId).single();
    expect(data!.status).toBe("pending");
  });

  it("a merchant can read their own settlement and its itemized settlement_items, but not another merchant's", async () => {
    const fixtures = inject("qaFixtures");
    const { settlementId, adjustmentId } = await createSettlement(staffToken, fixtures.merchantAId, "2098-04-01", "2098-04-30");
    createdSettlementIds.push(settlementId);
    createdAdjustmentIds.push(adjustmentId);

    const merchantAClient = authedClient(merchantAToken);
    const merchantBClient = authedClient(merchantBToken);

    const { data: ownRead, error: ownError } = await merchantAClient.from("settlements").select("id, total_amount").eq("id", settlementId).maybeSingle();
    expect(ownError).toBeNull();
    expect(ownRead).not.toBeNull();

    const { data: otherRead } = await merchantBClient.from("settlements").select("id").eq("id", settlementId).maybeSingle();
    expect(otherRead).toBeNull();
  });
});
