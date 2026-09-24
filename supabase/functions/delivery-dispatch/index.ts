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
import { sendNotification } from "../_shared/notify.ts";

const DELIVERY_TO_MERCHANT_ORDER_STATUS: Record<string, string> = {
  picked_up: "picked_up",
  delivered: "delivered",
};

// Same template-driven pattern as order-status/index.ts — no hardcoded
// customer-facing strings here, just the event type sendNotification()
// looks up in notification_templates.
const CUSTOMER_NOTIFY_EVENTS: Record<string, string> = {
  picked_up: "order_picked_up",
  delivered: "order_delivered",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authed = userClient(req);
    const { data: userData, error: authError } = await authed.auth.getUser();
    if (authError || !userData?.user) return jsonResponse({ error: "Not authenticated" }, 401);

    // Same rule RLS applies (migration 0051): admin tier, or the Delivery Ops
    // page on an active staff account's checklist.
    const { data: allowed } = await authed.rpc("has_admin_page", { p_keys: ["delivery_ops"] });
    if (allowed !== true) {
      return jsonResponse({ error: "Not authorized" }, 403);
    }

    const db = serviceClient();

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

      const notifyEvent = CUSTOMER_NOTIFY_EVENTS[status];
      if (notifyEvent) {
        const [{ data: orderInfo }, { data: merchantOrder }] = await Promise.all([
          db
            .from("merchant_orders")
            .select("orders!inner(customer_id)")
            .eq("id", delivery.merchant_order_id)
            .single(),
          db.from("merchant_orders").select("merchant_id, merchants(business_name)").eq("id", delivery.merchant_order_id).single(),
        ]);
        const customerId = (orderInfo as unknown as { orders: { customer_id: string } } | null)?.orders?.customer_id;
        const merchantName = (merchantOrder as unknown as { merchants: { business_name: string } | null } | null)?.merchants
          ?.business_name;
        if (customerId) {
          await sendNotification(db, customerId, notifyEvent, {
            order_id_short: delivery.merchant_order_id.slice(0, 8),
            merchant_name: merchantName ?? "the merchant",
          });
        }
      }

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
