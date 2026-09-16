// POST /delivery-dispatch
// body: { delivery_id: string, status: string, driver_id?: string, location?: object, note?: string }
// Receives status pushes from Tolo's delivery/driver system and mirrors them
// onto deliveries, delivery_tracking, and the owning merchant_order. This is
// the integration seam described in the platform spec (section 15) — swap
// the TODO for a call into the real dispatch API once it's available.
import { serviceClient } from "../_shared/client.ts";
import { jsonResponse } from "../_shared/cors.ts";

const DELIVERY_TO_MERCHANT_ORDER_STATUS: Record<string, string> = {
  picked_up: "picked_up",
  delivered: "delivered",
};

Deno.serve(async (req) => {
  try {
    // TODO: authenticate this request as coming from the Tolo delivery
    // system (shared secret / mTLS), not an arbitrary caller.
    const { delivery_id, status, driver_id, location, note } = await req.json();
    if (!delivery_id || !status) {
      return jsonResponse({ error: "delivery_id and status are required" }, 400);
    }

    const db = serviceClient();

    const update: Record<string, unknown> = { status };
    if (driver_id) update.driver_id = driver_id;

    const { data: delivery, error } = await db
      .from("deliveries")
      .update(update)
      .eq("id", delivery_id)
      .select("merchant_order_id")
      .single();

    if (error || !delivery) return jsonResponse({ error: "Delivery not found" }, 404);

    await db.from("delivery_tracking").insert({ delivery_id, status, location, note });

    const moStatus = DELIVERY_TO_MERCHANT_ORDER_STATUS[status];
    if (moStatus) {
      await db.from("merchant_orders").update({ status: moStatus }).eq("id", delivery.merchant_order_id);
      await db.from("order_status_history").insert({
        merchant_order_id: delivery.merchant_order_id,
        status: moStatus,
        note: `Delivery status: ${status}`,
      });

      if (moStatus === "delivered") {
        await db.from("merchant_orders").update({ status: "completed" }).eq("id", delivery.merchant_order_id);
        await db.from("order_status_history").insert({
          merchant_order_id: delivery.merchant_order_id,
          status: "completed",
          note: "Auto-completed after delivery confirmation",
        });
      }
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
