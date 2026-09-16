// POST /checkout
// body: { address_id: string, payment_provider: string }
// Reads the caller's cart, atomically creates the master order + merchant
// orders + reserves stock (via the create_order() SQL function), then opens
// a pending payment record. Stock reservations are rolled back automatically
// if any line fails (insufficient stock, invalid variant, etc).
import { serviceClient, userClient } from "../_shared/client.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

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
      return jsonResponse({ error: orderError.message }, 400);
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
