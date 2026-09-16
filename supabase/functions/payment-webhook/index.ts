// POST /payment-webhook/:payment_id
// Called by the payment provider (not the browser). Verifies the payment
// server-side, then — only on verified success — converts reserved stock
// into confirmed sales and posts the sale/commission entries to each
// merchant's wallet ledger. Never trust a client-supplied "paid" status.
import { serviceClient } from "../_shared/client.ts";
import { jsonResponse } from "../_shared/cors.ts";
import { getPaymentProvider } from "../_shared/payment_providers.ts";

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const paymentId = url.pathname.split("/").pop();
    if (!paymentId) return jsonResponse({ error: "Missing payment id" }, 400);

    const payload = await req.json();
    const db = serviceClient();

    const { data: payment } = await db
      .from("payments")
      .select("id, order_id, amount, status, provider")
      .eq("id", paymentId)
      .maybeSingle();

    if (!payment) return jsonResponse({ error: "Payment not found" }, 404);
    if (payment.status === "verified") return jsonResponse({ ok: true, already_processed: true });

    const provider = getPaymentProvider(payment.provider);
    const result = await provider.verify(payload, req.headers);

    await db.from("payment_transactions").insert({
      payment_id: payment.id,
      provider_reference: result.providerReference,
      status: result.verified ? "verified" : "failed",
      raw_response: result.rawResponse,
      verified_at: result.verified ? new Date().toISOString() : null,
    });

    if (!result.verified) {
      await db.from("payments").update({ status: "failed" }).eq("id", payment.id);
      return jsonResponse({ ok: false });
    }

    await db.from("payments").update({ status: "verified" }).eq("id", payment.id);
    await db.from("orders").update({ payment_status: "paid" }).eq("id", payment.order_id);

    const { data: merchantOrders } = await db
      .from("merchant_orders")
      .select("id, merchant_id, merchant_payable")
      .eq("order_id", payment.order_id);

    for (const mo of merchantOrders ?? []) {
      const { data: items } = await db
        .from("order_items")
        .select("variant_id, quantity")
        .eq("merchant_order_id", mo.id);

      for (const item of items ?? []) {
        await db.rpc("release_stock", {
          p_variant_id: item.variant_id,
          p_quantity: item.quantity,
          p_reference_id: payment.order_id,
          p_as_sale: true,
        });
      }

      // Merchant is credited their full listed price (merchant_payable).
      // Tolo's commission is additional revenue on top of that, not a
      // deduction from the merchant's wallet — see merchant_orders.commission_amount.
      await db.rpc("post_wallet_transaction", {
        p_merchant_id: mo.merchant_id,
        p_merchant_order_id: mo.id,
        p_type: "sale",
        p_amount: mo.merchant_payable,
        p_note: "Order payment confirmed",
      });
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
