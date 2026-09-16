// POST /order-status
// body: { merchant_order_id: string, status: string, note?: string }
// Validates the requested transition, checks the caller is staff of the
// owning merchant (or Tolo staff), applies it, and logs it to
// order_status_history. Reaching "ready_for_pickup" opens a delivery record.
import { serviceClient, userClient } from "../_shared/client.ts";
import { jsonResponse } from "../_shared/cors.ts";

const MERCHANT_TRANSITIONS: Record<string, string[]> = {
  new: ["accepted", "rejected"],
  accepted: ["processing", "cancelled"],
  processing: ["ready_for_pickup", "cancelled"],
};

Deno.serve(async (req) => {
  try {
    const authed = userClient(req);
    const { data: userData, error: authError } = await authed.auth.getUser();
    if (authError || !userData?.user) return jsonResponse({ error: "Not authenticated" }, 401);

    const { merchant_order_id, status, note } = await req.json();
    if (!merchant_order_id || !status) {
      return jsonResponse({ error: "merchant_order_id and status are required" }, 400);
    }

    const db = serviceClient();

    const { data: mo } = await db
      .from("merchant_orders")
      .select("id, merchant_id, status")
      .eq("id", merchant_order_id)
      .maybeSingle();

    if (!mo) return jsonResponse({ error: "Merchant order not found" }, 404);

    const allowed = MERCHANT_TRANSITIONS[mo.status] ?? [];
    if (!allowed.includes(status)) {
      return jsonResponse(
        { error: `Cannot move from ${mo.status} to ${status}` },
        400,
      );
    }

    const { data: membership } = await db
      .from("merchant_staff")
      .select("id")
      .eq("merchant_id", mo.merchant_id)
      .eq("user_id", userData.user.id)
      .maybeSingle();

    const { data: owned } = await db
      .from("merchants")
      .select("id")
      .eq("id", mo.merchant_id)
      .eq("owner_id", userData.user.id)
      .maybeSingle();

    if (!membership && !owned) {
      return jsonResponse({ error: "Not authorized for this merchant" }, 403);
    }

    const update: Record<string, unknown> = { status };
    const now = new Date().toISOString();
    // "accepted" is the spec's "ORDER RECEIVED" acknowledgement — this
    // timestamp, not the notification, is what counts as the merchant
    // having actually seen the order.
    if (status === "accepted") {
      update.order_received_at = now;
      update.received_by = userData.user.id;
    }
    if (status === "processing") update.preparation_started_at = now;
    if (status === "ready_for_pickup") update.ready_for_pickup_at = now;

    await db.from("merchant_orders").update(update).eq("id", mo.id);
    await db.from("order_status_history").insert({
      merchant_order_id: mo.id,
      status,
      changed_by: userData.user.id,
      note,
    });

    if (status === "ready_for_pickup") {
      await db.from("deliveries").insert({ merchant_order_id: mo.id });
      // TODO: notify the Tolo delivery dispatch system (see delivery-dispatch function).
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
