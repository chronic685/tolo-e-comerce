// POST /payment-initiate
// body: { payment_id: string }
// (Re)starts an online payment for an order the caller already placed: the
// "Pay now" button on the order page. Needed because the first attempt can
// fail to start (gateway down) or be abandoned, and the stock for the order is
// already reserved, so the customer must be able to try again rather than
// re-order. Same helper checkout uses for the first attempt.
import { serviceClient, userClient } from "../_shared/client.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { getPaymentProvider, isGatewayProviderName } from "../_shared/payment_providers.ts";
import { getCustomerAppUrl, loadGatewayCustomer, startGatewayPayment } from "../_shared/payment_start.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authed = userClient(req);
    const { data: userData, error: authError } = await authed.auth.getUser();
    if (authError || !userData?.user) return jsonResponse({ error: "Not authenticated" }, 401);
    const userId = userData.user.id;

    const { payment_id } = await req.json();
    if (!payment_id) return jsonResponse({ error: "payment_id is required" }, 400);

    const db = serviceClient();

    const { data: rateLimit } = await db
      .rpc("check_and_record_rate_limit", { p_key: `customer:${userId}:payment_initiate`, p_max_count: 10, p_window_seconds: 600 })
      .single();
    if (rateLimit && !rateLimit.allowed) {
      return jsonResponse(
        { error: "too_many_requests", message: "Too many requests. Please try again shortly." },
        429,
        rateLimit.retry_after_seconds ? { "Retry-After": String(rateLimit.retry_after_seconds) } : undefined,
      );
    }

    const { data: payment } = await db
      .from("payments")
      .select("id, order_id, amount, currency, status, provider")
      .eq("id", payment_id)
      .maybeSingle();
    if (!payment) return jsonResponse({ error: "Payment not found" }, 404);

    const { data: order } = await db.from("orders").select("customer_id, payment_status").eq("id", payment.order_id).single();
    // Not-yours looks exactly like not-found, so payment ids can't be probed.
    if (!order || order.customer_id !== userId) return jsonResponse({ error: "Payment not found" }, 404);

    const provider = isGatewayProviderName(payment.provider) ? getPaymentProvider(payment.provider) : undefined;
    if (!provider) return jsonResponse({ error: "This payment method is not currently available." }, 400);

    if (payment.status === "verified" || order.payment_status === "paid") {
      return jsonResponse({ error: "This order is already paid." }, 409);
    }
    if (payment.status !== "pending" && payment.status !== "failed") {
      return jsonResponse({ error: `Cannot pay an order whose payment is "${payment.status}".` }, 409);
    }

    // Don't take money for an order that has already been cancelled/rejected.
    const { data: merchantOrders } = await db.from("merchant_orders").select("status").eq("order_id", payment.order_id);
    if (merchantOrders && merchantOrders.length > 0 && merchantOrders.every((mo) => mo.status === "cancelled" || mo.status === "rejected")) {
      return jsonResponse({ error: "This order was cancelled and can no longer be paid." }, 409);
    }

    // A previously failed attempt is retried as a fresh pending one.
    if (payment.status === "failed") {
      await db.from("payments").update({ status: "pending" }).eq("id", payment.id).eq("status", "failed");
    }

    const customer = await loadGatewayCustomer(db, userId, userData.user.email);
    const started = await startGatewayPayment(db, provider, payment, customer, getCustomerAppUrl());
    if ("error" in started) return jsonResponse({ error: started.error }, 502);

    return jsonResponse({ payment_id: payment.id, checkout_url: started.checkoutUrl });
  } catch (err) {
    console.error("payment-initiate failed:", err);
    return jsonResponse({ error: "Internal error" }, 500);
  }
});
