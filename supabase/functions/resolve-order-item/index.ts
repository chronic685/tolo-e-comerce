// POST /resolve-order-item
// body: { order_item_id: string, action: "remove" | "substitute", substitute_variant_id?: string, note?: string }
// Group 4, item 15: the merchant-facing counterpart to a customer's
// checkout-time on_unavailable choice. Authorizes the caller as staff of
// the owning merchant (or Tolo staff) here in TypeScript -- the SQL
// function itself is SECURITY DEFINER and only ever called via the
// service-role client below, under which auth.uid() is null, so this
// edge function is the real authorization boundary, same as order-status.
//
// "cancel_order" is deliberately not a supported action here -- that's
// the existing whole-merchant_order reject/cancel transition
// (order-status), which already releases every item and refunds the
// whole merchant_order. The merchant dashboard calls that directly.
import { serviceClient, userClient } from "../_shared/client.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

function sanitizeError(message: string): string {
  if (message.includes("already been resolved")) return "This item has already been resolved.";
  if (message.includes("can no longer be modified")) return "This order can no longer be modified.";
  if (message.includes("Not authorized")) return "You are not authorized to perform this action.";
  if (message.includes("must be one of your own")) return "The replacement product must be one of your own.";
  if (message.includes("not currently published")) return "The replacement product is not currently published.";
  if (message.includes("Insufficient stock")) return "The replacement product does not have enough stock.";
  if (message.includes("replacement product is required")) return "Please choose a replacement product.";
  console.error("resolve_unavailable_order_item failed:", message);
  return "Could not update this item. Please try again.";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authed = userClient(req);
    const { data: userData, error: authError } = await authed.auth.getUser();
    if (authError || !userData?.user) return jsonResponse({ error: "Not authenticated" }, 401);

    const { order_item_id, action, substitute_variant_id, note } = await req.json();
    if (!order_item_id || !action) {
      return jsonResponse({ error: "order_item_id and action are required" }, 400);
    }
    if (action !== "remove" && action !== "substitute") {
      return jsonResponse({ error: "Unsupported action" }, 400);
    }

    const db = serviceClient();

    const { data: item } = await db
      .from("order_items")
      .select("id, merchant_order_id, merchant_orders!inner ( merchant_id )")
      .eq("id", order_item_id)
      .maybeSingle();

    if (!item) return jsonResponse({ error: "Order item not found" }, 404);

    const merchantId = (item as unknown as { merchant_orders: { merchant_id: string } }).merchant_orders.merchant_id;

    const [{ data: membership }, { data: owned }] = await Promise.all([
      db.from("merchant_staff").select("id").eq("merchant_id", merchantId).eq("user_id", userData.user.id).maybeSingle(),
      db.from("merchants").select("id").eq("id", merchantId).eq("owner_id", userData.user.id).maybeSingle(),
    ]);

    if (!membership && !owned) {
      return jsonResponse({ error: "Not authorized for this merchant" }, 403);
    }

    const { error } = await db.rpc("resolve_unavailable_order_item", {
      p_order_item_id: order_item_id,
      p_action: action,
      p_substitute_variant_id: substitute_variant_id || null,
      p_note: note || null,
    });

    if (error) return jsonResponse({ error: sanitizeError(error.message) }, 400);

    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
