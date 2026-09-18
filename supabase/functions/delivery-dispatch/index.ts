// POST /delivery-dispatch
// body: { delivery_id: string, status: string, driver_id?: string, location?: object, note?: string }
// Receives status pushes and mirrors them onto deliveries, delivery_tracking,
// and the owning merchant_order. This is the integration seam described in
// the platform spec (section 15) for Tolo's delivery/driver system — but no
// real external dispatch system is connected yet (see External Integrations
// spec section 21), and the only actual caller today is the admin dashboard's
// Deliveries page, so this requires authenticated Tolo staff for now. Once a
// real dispatch system is connected, it will need its own adapter (shared
// secret / mTLS) rather than a user session — do not weaken this check to
// accommodate that later; add a second, separately-authenticated path.
import { serviceClient, userClient } from "../_shared/client.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

const DELIVERY_TO_MERCHANT_ORDER_STATUS: Record<string, string> = {
  picked_up: "picked_up",
  delivered: "delivered",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authed = userClient(req);
    const { data: userData, error: authError } = await authed.auth.getUser();
    if (authError || !userData?.user) return jsonResponse({ error: "Not authenticated" }, 401);

    const db = serviceClient();

    const { data: profile } = await db.from("profiles").select("role").eq("id", userData.user.id).maybeSingle();
    const staffRoles = ["tolo_ops", "tolo_admin", "tolo_finance", "tolo_marketing", "tolo_support", "tolo_merchant_verification"];
    if (!profile || !staffRoles.includes(profile.role)) {
      return jsonResponse({ error: "Not authorized" }, 403);
    }

    const { delivery_id, status, driver_id, location, note } = await req.json();
    if (!delivery_id || !status) {
      return jsonResponse({ error: "delivery_id and status are required" }, 400);
    }

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
