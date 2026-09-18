// Shared "payment just became real" / "payment failed" logic — the same
// steps run whether a payment is confirmed by an external gateway webhook
// (payment-webhook) or by a human asserting it manually (confirm-payment,
// for cash/bank-transfer/mobile-money, none of which have a real gateway
// connected yet). Keeping this in one place means both callers stay in sync.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendNotification } from "./notify.ts";

interface PaymentRow {
  id: string;
  order_id: string;
  amount: number;
}

export async function finalizePaymentSuccess(db: SupabaseClient, payment: PaymentRow) {
  await db.from("payments").update({ status: "verified" }).eq("id", payment.id);
  await db.from("orders").update({ payment_status: "paid" }).eq("id", payment.order_id);

  const { data: paidOrder } = await db.from("orders").select("customer_id").eq("id", payment.order_id).single();
  if (paidOrder) {
    await sendNotification(db, paidOrder.customer_id, "payment_success", {
      amount: payment.amount,
      order_id_short: payment.order_id.slice(0, 8),
    });
  }

  const { data: merchantOrders } = await db
    .from("merchant_orders")
    .select("id, merchant_id, merchant_payable")
    .eq("order_id", payment.order_id);

  const notifiedAt = new Date().toISOString();

  for (const mo of merchantOrders ?? []) {
    const { data: items } = await db
      .from("order_items")
      .select("variant_id, quantity, product_name_snapshot")
      .eq("merchant_order_id", mo.id);

    for (const item of items ?? []) {
      await db.rpc("release_stock", {
        p_variant_id: item.variant_id,
        p_quantity: item.quantity,
        p_reference_id: payment.order_id,
        p_as_sale: true,
      });
    }

    // Merchant is credited their full listed price (merchant_payable). Tolo's
    // commission is additional revenue on top of that, not a deduction from
    // the merchant's wallet — see merchant_orders.commission_amount.
    await db.rpc("post_wallet_transaction", {
      p_merchant_id: mo.merchant_id,
      p_merchant_order_id: mo.id,
      p_type: "sale",
      p_amount: mo.merchant_payable,
      p_note: "Order payment confirmed",
    });

    // notification_sent_at is the clock start for the merchant's
    // acknowledgement — never treat this row alone as proof the merchant
    // saw the order; only order_received_at (set when they press "Order
    // Received") counts as acknowledgement.
    await db.from("merchant_orders").update({ notification_sent_at: notifiedAt }).eq("id", mo.id);

    const { data: merchant } = await db.from("merchants").select("owner_id, business_name").eq("id", mo.merchant_id).single();
    if (merchant) {
      const itemCount = (items ?? []).reduce((sum: number, i: { quantity: number }) => sum + i.quantity, 0);
      await sendNotification(db, merchant.owner_id, "order_new", {
        order_id_short: mo.id.slice(0, 8),
        item_count: itemCount,
        amount: mo.merchant_payable,
      });
    }
  }
}

export async function finalizePaymentFailure(db: SupabaseClient, payment: PaymentRow) {
  await db.from("payments").update({ status: "failed" }).eq("id", payment.id);
  const { data: order } = await db.from("orders").select("customer_id").eq("id", payment.order_id).single();
  if (order) {
    await sendNotification(db, order.customer_id, "payment_failed", {
      order_id_short: payment.order_id.slice(0, 8),
    });
  }
}
