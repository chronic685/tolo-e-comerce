// POST /mock-gateway
// body: { payment_id: string, outcome: "success" | "failed" }
// The "hosted checkout page" of the MOCK gateway: the customer-app page at
// /mock-gateway/:payment_id calls this when its Pay / Fail button is pressed.
// It builds a callback signed the same way a real gateway would sign one and
// pushes it through the exact code payment-webhook uses (verify, amount check,
// atomic claim, finalize), so the whole online-payment path is exercised
// without any real gateway or money.
//
// Answers 404 unless mock mode is deliberately on (PAYMENT_GATEWAY_MODE=mock
// plus MOCK_GATEWAY_SECRET). It must never be enabled once real customers pay
// for real orders on this project: it marks orders paid on a button press.
import { serviceClient, userClient } from "../_shared/client.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { buildMockCallback, getDenoMockGatewaySecret, getPaymentProvider } from "../_shared/payment_providers.ts";
import { handleGatewayCallback } from "../_shared/payment_callback.ts";
import { supabaseCallbackStore } from "../_shared/payment_callback_store.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const secret = getDenoMockGatewaySecret();
    if (!secret) return jsonResponse({ error: "The mock payment gateway is not enabled." }, 404);

    const authed = userClient(req);
    const { data: userData, error: authError } = await authed.auth.getUser();
    if (authError || !userData?.user) return jsonResponse({ error: "Not authenticated" }, 401);

    const { payment_id, outcome } = await req.json();
    if (!payment_id || (outcome !== "success" && outcome !== "failed")) {
      return jsonResponse({ error: 'payment_id and outcome ("success" or "failed") are required' }, 400);
    }

    const db = serviceClient();
    const { data: payment } = await db
      .from("payments")
      .select("id, order_id, amount, currency, status, provider")
      .eq("id", payment_id)
      .maybeSingle();
    if (!payment) return jsonResponse({ error: "Payment not found" }, 404);

    // Only the customer who placed the order can "pay" it, like the real hosted page.
    const { data: order } = await db.from("orders").select("customer_id").eq("id", payment.order_id).single();
    if (!order || order.customer_id !== userData.user.id) return jsonResponse({ error: "Payment not found" }, 404);

    const provider = getPaymentProvider(payment.provider);
    if (!provider) return jsonResponse({ error: "This payment was not made through an online gateway." }, 400);

    // Use the reference from this attempt's initiate() so the audit trail links up.
    const { data: attempt } = await db
      .from("payment_transactions")
      .select("provider_reference")
      .eq("payment_id", payment.id)
      .eq("status", "pending")
      .not("provider_reference", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { rawBody, headers } = await buildMockCallback(secret, {
      payment_id: payment.id,
      reference: attempt?.provider_reference ?? `mock_${crypto.randomUUID()}`,
      amount: Number(payment.amount),
      currency: payment.currency,
      status: outcome,
    });

    const result = await provider.verify(rawBody, headers);
    const response = await handleGatewayCallback(
      { id: payment.id, status: payment.status, amount: Number(payment.amount), currency: payment.currency },
      result,
      supabaseCallbackStore(db, payment),
    );

    const { data: after } = await db.from("payments").select("status").eq("id", payment.id).single();
    return jsonResponse({ ...response.body, order_id: payment.order_id, payment_status: after?.status ?? null }, response.status);
  } catch (err) {
    console.error("mock-gateway failed:", err);
    return jsonResponse({ error: "Internal error" }, 500);
  }
});
