// POST /payment-webhook/:payment_id
// Called by an external payment gateway's server, not the browser. Verifies
// the payment via that gateway's own provider adapter, then — only on
// verified success — finalizes it (see _shared/payment_finalize.ts).
//
// No gateway is connected yet (see _shared/payment_providers.ts), so this
// currently returns 400 for every payment: cash/bank/mobile-money go through
// confirm-payment (authenticated, role-checked) instead of this public,
// unauthenticated endpoint. That is intentional — an unauthenticated webhook
// must never be trusted for a payment method with no real signature to check.
import { serviceClient } from "../_shared/client.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { getPaymentProvider } from "../_shared/payment_providers.ts";
import { finalizePaymentFailure, finalizePaymentSuccess } from "../_shared/payment_finalize.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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
    if (!provider) {
      return jsonResponse(
        { error: `${payment.provider} has no automated gateway connected — it must be confirmed manually via confirm-payment.` },
        400,
      );
    }

    const result = await provider.verify(payload, req.headers);

    await db.from("payment_transactions").insert({
      payment_id: payment.id,
      provider_reference: result.providerReference,
      status: result.verified ? "verified" : "failed",
      raw_response: result.rawResponse,
      verified_at: result.verified ? new Date().toISOString() : null,
    });

    if (!result.verified) {
      await finalizePaymentFailure(db, payment);
      return jsonResponse({ ok: false });
    }

    await finalizePaymentSuccess(db, payment);
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
