// POST /payment-webhook/:payment_id
// Called by an external payment gateway's server, not the browser. The
// gateway's provider adapter decides whether the callback is authentic and
// what it means; handleGatewayCallback (_shared/payment_callback.ts) then
// applies it safely: bad signatures change nothing, amounts must match, and
// duplicate deliveries can't double-credit anyone.
//
// No gateway is connected unless PAYMENT_GATEWAY_MODE=mock or a real adapter is
// registered (see _shared/payment_providers.ts), so by default this answers 400
// for every payment: cash/bank/mobile-money go through confirm-payment
// (authenticated, role-checked) instead of this public endpoint. That is
// intentional -- an unauthenticated webhook must never be trusted for a payment
// method with no real signature to check.
//
// verify_jwt is off for this function (supabase/config.toml) because a gateway
// has no Supabase JWT to send; the gateway signature is the only gate.
import { serviceClient } from "../_shared/client.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { getPaymentProvider } from "../_shared/payment_providers.ts";
import { handleGatewayCallback } from "../_shared/payment_callback.ts";
import { supabaseCallbackStore } from "../_shared/payment_callback_store.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const paymentId = url.pathname.split("/").pop();
    if (!paymentId) return jsonResponse({ error: "Missing payment id" }, 400);

    // Raw text, not req.json(): signatures are computed over the exact bytes.
    const rawBody = await req.text();
    const db = serviceClient();

    const { data: payment } = await db
      .from("payments")
      .select("id, order_id, amount, currency, status, provider")
      .eq("id", paymentId)
      .maybeSingle();

    if (!payment) return jsonResponse({ error: "Payment not found" }, 404);

    const provider = getPaymentProvider(payment.provider);
    if (!provider) {
      return jsonResponse(
        { error: `${payment.provider} has no automated gateway connected — it must be confirmed manually via confirm-payment.` },
        400,
      );
    }

    const result = await provider.verify(rawBody, req.headers);
    const response = await handleGatewayCallback(
      { id: payment.id, status: payment.status, amount: Number(payment.amount), currency: payment.currency },
      result,
      supabaseCallbackStore(db, payment),
    );
    return jsonResponse(response.body, response.status);
  } catch (err) {
    console.error("payment-webhook failed:", err);
    return jsonResponse({ error: "Internal error" }, 500);
  }
});
