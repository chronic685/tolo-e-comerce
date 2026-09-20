// POST /settlement-run
// body: { merchant_id: string, period_start: string, period_end: string }
// Tolo-finance-only. Batches every "completed" merchant_order in the period
// that isn't already in a settlement into a new settlement + settlement_items,
// nets in any not-yet-consumed financial_adjustments for the merchant, and
// posts a "settlement" debit to the merchant's wallet ledger.
//
// Phase 5d, item 6: adjustments are one-off corrections (bonus/penalty/etc.)
// with no period of their own (financial_adjustments has no period_start/end
// column) — they're picked up by whichever settlement run for that merchant
// happens next, regardless of when they were created, and are then marked
// consumed by stamping their settlement_id so a later run never reapplies
// them. This also means a settlement can now be created from adjustments
// alone even when there are no eligible merchant_orders in the period.
import { serviceClient, userClient } from "../_shared/client.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authed = userClient(req);
    const { data: userData, error: authError } = await authed.auth.getUser();
    if (authError || !userData?.user) return jsonResponse({ error: "Not authenticated" }, 401);

    const db = serviceClient();

    const { data: profile } = await db
      .from("profiles")
      .select("role")
      .eq("id", userData.user.id)
      .single();

    if (!profile || !["tolo_finance", "tolo_admin"].includes(profile.role)) {
      return jsonResponse({ error: "Not authorized" }, 403);
    }

    const { merchant_id, period_start, period_end } = await req.json();
    if (!merchant_id || !period_start || !period_end) {
      return jsonResponse({ error: "merchant_id, period_start, period_end are required" }, 400);
    }

    const { data: settledIds } = await db
      .from("settlement_items")
      .select("merchant_order_id, settlement:settlements!inner(merchant_id)")
      .eq("settlement.merchant_id", merchant_id);

    const alreadySettled = new Set((settledIds ?? []).map((r) => r.merchant_order_id));

    const { data: eligible } = await db
      .from("merchant_orders")
      .select("id, merchant_payable, created_at")
      .eq("merchant_id", merchant_id)
      .eq("status", "completed")
      .gte("created_at", period_start)
      .lte("created_at", period_end);

    const items = (eligible ?? []).filter((mo) => !alreadySettled.has(mo.id));

    const { data: unsettledAdjustments } = await db
      .from("financial_adjustments")
      .select("id, amount")
      .eq("merchant_id", merchant_id)
      .is("settlement_id", null);

    const adjustments = unsettledAdjustments ?? [];

    if (items.length === 0 && adjustments.length === 0) {
      return jsonResponse({ ok: true, message: "Nothing to settle for this period" });
    }

    const ordersTotal = items.reduce((sum, mo) => sum + Number(mo.merchant_payable), 0);
    const adjustmentsTotal = adjustments.reduce((sum, a) => sum + Number(a.amount), 0);
    const total = ordersTotal + adjustmentsTotal;

    const { data: settlement, error: settlementError } = await db
      .from("settlements")
      .insert({ merchant_id, period_start, period_end, total_amount: total })
      .select()
      .single();

    if (settlementError) return jsonResponse({ error: settlementError.message }, 400);

    if (items.length > 0) {
      await db.from("settlement_items").insert(
        items.map((mo) => ({
          settlement_id: settlement.id,
          merchant_order_id: mo.id,
          amount: mo.merchant_payable,
        })),
      );
    }

    if (adjustments.length > 0) {
      await db
        .from("financial_adjustments")
        .update({ settlement_id: settlement.id })
        .in("id", adjustments.map((a) => a.id));
    }

    await db.rpc("post_wallet_transaction", {
      p_merchant_id: merchant_id,
      p_merchant_order_id: null,
      p_type: "settlement",
      p_amount: -total,
      p_note: `Settlement ${settlement.id} for ${period_start}..${period_end}`,
    });

    return jsonResponse({
      ok: true,
      settlement_id: settlement.id,
      total_amount: total,
      item_count: items.length,
      adjustments_netted: adjustments.length,
    });
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
