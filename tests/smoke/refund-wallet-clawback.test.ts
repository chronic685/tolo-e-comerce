import { describe, expect, inject, it } from "vitest";
import { serviceClient } from "../env.ts";

// Phase 5a, item 2: completing a refund must claw back the wallet credit
// finalizePaymentSuccess gave the merchant (migration 0034's trigger on
// refunds, reusing post_wallet_transaction — no new ledger mechanism).
// Directly exercises the refunds/returns tables the way the admin
// Refunds.tsx page does (plain .update()), not a new RPC, since that's
// exactly the path the trigger has to intercept.
const db = serviceClient();

async function getWalletBalance(merchantId: string): Promise<number> {
  const { data } = await db.from("merchant_wallets").select("balance").eq("merchant_id", merchantId).maybeSingle();
  return data ? Number(data.balance) : 0;
}

async function createReturnAndRefund(merchantOrderId: string, customerId: string, amount: number) {
  const { data: returnRow, error: returnError } = await db
    .from("returns")
    .insert({ merchant_order_id: merchantOrderId, customer_id: customerId, reason: "QA TEST — Phase 5a", status: "approved" })
    .select("id")
    .single();
  if (returnError) throw returnError;

  const { data: refundRow, error: refundError } = await db
    .from("refunds")
    .insert({ return_id: returnRow.id, amount, status: "pending" })
    .select("id")
    .single();
  if (refundError) throw refundError;

  return refundRow.id as string;
}

describe("refunds: wallet clawback on completion", () => {
  it("debits the merchant's wallet by exactly the refund amount once completed, not on approval/pending", async () => {
    const fixtures = inject("qaFixtures");
    const merchantOrderId = fixtures.reviewableMerchantOrderId;

    // A known, disposable sale credit to claw back from — independent of
    // whatever real wallet history already exists for this merchant.
    await db.rpc("post_wallet_transaction", {
      p_merchant_id: fixtures.merchantAId,
      p_merchant_order_id: merchantOrderId,
      p_type: "sale",
      p_amount: 100,
      p_note: "QA TEST fixture credit for refund clawback test",
    });
    const balanceBeforeRefund = await getWalletBalance(fixtures.merchantAId);

    const refundId = await createReturnAndRefund(merchantOrderId, fixtures.customerUserId, 40);

    // Pending must not claw back anything yet — only a completed refund
    // represents money that actually left Tolo's side.
    expect(await getWalletBalance(fixtures.merchantAId)).toBe(balanceBeforeRefund);

    const { error: completeError } = await db
      .from("refunds")
      .update({ status: "completed", processed_at: new Date().toISOString() })
      .eq("id", refundId);
    expect(completeError).toBeNull();

    expect(await getWalletBalance(fixtures.merchantAId)).toBe(balanceBeforeRefund - 40);

    const { data: txn } = await db
      .from("wallet_transactions")
      .select("type, amount, merchant_order_id")
      .eq("merchant_order_id", merchantOrderId)
      .eq("type", "refund")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    expect(txn).not.toBeNull();
    expect(Number(txn!.amount)).toBe(-40);
  });

  it("does not claw back a second time if an already-completed refund row is updated again", async () => {
    const fixtures = inject("qaFixtures");
    const merchantOrderId = fixtures.reviewableMerchantOrderId;

    const refundId = await createReturnAndRefund(merchantOrderId, fixtures.customerUserId, 15);
    await db.from("refunds").update({ status: "completed", processed_at: new Date().toISOString() }).eq("id", refundId);

    const balanceAfterFirstComplete = await getWalletBalance(fixtures.merchantAId);

    // Touching the row again while status stays "completed" (e.g. a future
    // unrelated edit) must not re-fire the clawback.
    const { error } = await db.from("refunds").update({ processed_at: new Date().toISOString() }).eq("id", refundId);
    expect(error).toBeNull();

    expect(await getWalletBalance(fixtures.merchantAId)).toBe(balanceAfterFirstComplete);
  });

  it("marking a refund failed does not touch the wallet", async () => {
    const fixtures = inject("qaFixtures");
    const merchantOrderId = fixtures.reviewableMerchantOrderId;

    const balanceBefore = await getWalletBalance(fixtures.merchantAId);
    const refundId = await createReturnAndRefund(merchantOrderId, fixtures.customerUserId, 25);

    const { error } = await db.from("refunds").update({ status: "failed" }).eq("id", refundId);
    expect(error).toBeNull();

    expect(await getWalletBalance(fixtures.merchantAId)).toBe(balanceBefore);
  });

  it("a refund inserted as already-completed is clawed back too (not just the pending-→completed path)", async () => {
    const fixtures = inject("qaFixtures");
    const merchantOrderId = fixtures.reviewableMerchantOrderId;

    const balanceBefore = await getWalletBalance(fixtures.merchantAId);

    const { data: returnRow, error: returnError } = await db
      .from("returns")
      .insert({ merchant_order_id: merchantOrderId, customer_id: fixtures.customerUserId, reason: "QA TEST — Phase 5a direct-complete", status: "approved" })
      .select("id")
      .single();
    expect(returnError).toBeNull();

    const { error: refundError } = await db
      .from("refunds")
      .insert({ return_id: returnRow!.id, amount: 10, status: "completed", processed_at: new Date().toISOString() });
    expect(refundError).toBeNull();

    expect(await getWalletBalance(fixtures.merchantAId)).toBe(balanceBefore - 10);
  });
});
