// POST /checkout
// body: { address_id: string, payment_provider: string }
// Reads the caller's cart, atomically creates the master order + merchant
// orders + reserves stock (via the create_order() SQL function), then opens
// a pending payment record. Stock reservations are rolled back automatically
// if any line fails (insufficient stock, invalid variant, etc).
import { serviceClient, userClient } from "../_shared/client.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

// create_order() raises plain Postgres exceptions (see 0026+ migrations) —
// those messages are meant for developers reading function source, not for
// customers, and can include internal identifiers (variant UUIDs). Map the
// known cases to safe, generic text + the right status code; log the raw
// message server-side (Edge Function logs) instead of returning it.
function sanitizeOrderError(message: string): { status: number; error: string } {
  if (message.includes("Insufficient stock")) {
    return { status: 409, error: "One or more items in your cart are no longer available in the requested quantity." };
  }
  if (message.includes("suspended")) {
    return { status: 403, error: "This account is suspended and cannot place new orders." };
  }
  if (message.includes("maintenance")) {
    return { status: 503, error: "Tolo is temporarily under maintenance. Please try again shortly." };
  }
  if (message.includes("no items")) {
    return { status: 400, error: "Your cart is empty." };
  }
  if (message.includes("not currently available for orders")) {
    return { status: 409, error: "One or more stores in your cart are not currently available. Please review your cart." };
  }
  if (message.includes("no longer available:")) {
    return { status: 409, error: "One or more items in your cart are no longer available. Please review your cart." };
  }
  if (message.includes("Not authorized")) {
    return { status: 403, error: "You are not authorized to perform this action." };
  }
  console.error("create_order failed:", message);
  return { status: 400, error: "Could not place your order. Please check your cart and try again." };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authed = userClient(req);
    const { data: userData, error: authError } = await authed.auth.getUser();
    if (authError || !userData?.user) {
      return jsonResponse({ error: "Not authenticated" }, 401);
    }
    const customerId = userData.user.id;

    const { address_id, payment_provider } = await req.json();
    if (!address_id || !payment_provider) {
      return jsonResponse({ error: "address_id and payment_provider are required" }, 400);
    }

    const db = serviceClient();

    // Rate-limit only after authentication and basic input validation have
    // passed — an unauthenticated or malformed request must never consume a
    // real customer's quota, and this check must happen before the
    // expensive/money-moving create_order() call, not after it.
    const { data: rateLimitConfig } = await db.rpc("get_rate_limit_config", { p_action: "checkout" }).single();
    const { data: rateLimit } = await db
      .rpc("check_and_record_rate_limit", {
        p_key: `customer:${customerId}:checkout`,
        p_max_count: rateLimitConfig?.max_count ?? 5,
        p_window_seconds: rateLimitConfig?.window_seconds ?? 600,
      })
      .single();

    if (rateLimit && !rateLimit.allowed) {
      return jsonResponse(
        { error: "too_many_requests", message: "Too many requests. Please try again shortly." },
        429,
        rateLimit.retry_after_seconds ? { "Retry-After": String(rateLimit.retry_after_seconds) } : undefined,
      );
    }

    const { data: cart } = await db
      .from("carts")
      .select("id")
      .eq("customer_id", customerId)
      .maybeSingle();

    if (!cart) return jsonResponse({ error: "Cart is empty" }, 400);

    const { data: items } = await db
      .from("cart_items")
      .select("variant_id, quantity")
      .eq("cart_id", cart.id);

    if (!items || items.length === 0) {
      return jsonResponse({ error: "Cart is empty" }, 400);
    }

    const { data: orderId, error: orderError } = await db.rpc("create_order", {
      p_customer_id: customerId,
      p_address_id: address_id,
      p_items: items,
    });

    if (orderError) {
      const { status, error } = sanitizeOrderError(orderError.message);
      return jsonResponse({ error }, status);
    }

    const { data: order } = await db
      .from("orders")
      .select("total")
      .eq("id", orderId)
      .single();

    const { data: payment, error: paymentError } = await db
      .from("payments")
      .insert({
        order_id: orderId,
        provider: payment_provider,
        amount: order!.total,
      })
      .select()
      .single();

    if (paymentError) return jsonResponse({ error: paymentError.message }, 400);

    await db.from("cart_items").delete().eq("cart_id", cart.id);

    return jsonResponse({ order_id: orderId, payment_id: payment.id, amount: order!.total });
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
