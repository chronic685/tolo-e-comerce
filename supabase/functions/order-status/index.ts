// POST /order-status
// body: { merchant_order_id: string, status: string, note?: string }
// Validates the requested transition, checks the caller is staff of the
// owning merchant (or Tolo staff), applies it, and logs it to
// order_status_history. Reaching "ready_for_pickup" opens a delivery record.
import { serviceClient, userClient } from "../_shared/client.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { sendNotification } from "../_shared/notify.ts";

const MERCHANT_TRANSITIONS: Record<string, string[]> = {
  new: ["accepted", "rejected"],
  accepted: ["processing", "cancelled"],
  processing: ["ready_for_pickup", "cancelled"],
};

// Phase 5d, item 8: the only customer-initiated transition. Restricted to
// "new" — before the merchant has accepted (the spec's own "ORDER RECEIVED"
// commitment moment: see order_received_at below, and the unacknowledged-
// order escalation timers in migration 0033). MERCHANT_TRANSITIONS itself
// already draws this line for merchants — "rejected" only exists from "new",
// while post-acceptance orders only ever move to "cancelled" once real
// prep/staff/ingredient cost may already be committed. A customer-facing
// cancel button follows the same boundary rather than opening a new one.
const CUSTOMER_TRANSITIONS: Record<string, string[]> = {
  new: ["cancelled"],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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
      .select("id, order_id, merchant_id, status")
      .eq("id", merchant_order_id)
      .maybeSingle();

    if (!mo) return jsonResponse({ error: "Merchant order not found" }, 404);

    const merchantAllowed = MERCHANT_TRANSITIONS[mo.status] ?? [];
    const customerAllowed = CUSTOMER_TRANSITIONS[mo.status] ?? [];
    if (!merchantAllowed.includes(status) && !customerAllowed.includes(status)) {
      return jsonResponse(
        { error: `Cannot move from ${mo.status} to ${status}` },
        400,
      );
    }

    if (customerAllowed.includes(status)) {
      const { data: orderRow } = await db
        .from("orders")
        .select("customer_id")
        .eq("id", mo.order_id)
        .single();

      if (orderRow?.customer_id !== userData.user.id) {
        return jsonResponse({ error: "Not authorized for this order" }, 403);
      }

      const { data: featureSettings } = await db
        .from("system_settings")
        .select("value")
        .eq("key", "customer_features")
        .maybeSingle();
      const cancellationEnabled =
        (featureSettings?.value as { order_cancellation_enabled?: boolean } | null)?.order_cancellation_enabled ?? true;
      if (!cancellationEnabled) {
        return jsonResponse({ error: "Order cancellation is currently disabled" }, 403);
      }
    } else {
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

    if (status === "rejected" || status === "cancelled") {
      // The stock reserved at checkout (create_order() -> reserve_stock())
      // is only ever converted to a real sale on payment confirmation
      // (finalizePaymentSuccess). Declining or cancelling before that point
      // must give it back, or reserved_quantity — and therefore
      // available_quantity — stays permanently inflated for stock that was
      // never actually sold.
      const { data: items } = await db
        .from("order_items")
        .select("variant_id, quantity")
        .eq("merchant_order_id", mo.id);
      for (const item of items ?? []) {
        await db.rpc("release_stock", {
          p_variant_id: item.variant_id,
          p_quantity: item.quantity,
          p_reference_id: mo.order_id,
          p_as_sale: false,
        });
      }
    }

    const CUSTOMER_NOTIFY_EVENTS: Record<string, string> = {
      accepted: "order_received",
      processing: "order_preparing",
      ready_for_pickup: "order_ready_for_pickup",
      rejected: "order_rejected",
      cancelled: "order_cancelled",
    };
    const notifyEvent = CUSTOMER_NOTIFY_EVENTS[status];
    if (notifyEvent) {
      const [{ data: orderInfo }, { data: merchantInfo }] = await Promise.all([
        db
          .from("merchant_orders")
          .select("orders!inner(customer_id)")
          .eq("id", mo.id)
          .single(),
        db.from("merchants").select("business_name").eq("id", mo.merchant_id).single(),
      ]);
      const customerId = (orderInfo as unknown as { orders: { customer_id: string } } | null)?.orders?.customer_id;
      if (customerId) {
        await sendNotification(db, customerId, notifyEvent, {
          order_id_short: mo.id.slice(0, 8),
          merchant_name: merchantInfo?.business_name ?? "the merchant",
        });
      }
    }

    if (status === "ready_for_pickup") {
      // Pickup/dropoff are pulled from records the system already has — the
      // store's own location and the order's delivery address — never asked
      // for again at delivery-creation time (spec: "No Duplicate Data Entry").
      const [{ data: store }, { data: merchant }, { data: orderRow }] = await Promise.all([
        db.from("stores").select("latitude, longitude, pickup_address, name").eq("merchant_id", mo.merchant_id).maybeSingle(),
        db.from("merchants").select("business_name, phone").eq("id", mo.merchant_id).single(),
        db
          .from("merchant_orders")
          .select("orders!inner(addresses!inner(recipient_name, phone, line1, city, latitude, longitude))")
          .eq("id", mo.id)
          .single(),
      ]);

      const address = (orderRow as unknown as { orders: { addresses: Record<string, unknown> } } | null)?.orders?.addresses;

      await db.from("deliveries").insert({
        merchant_order_id: mo.id,
        pickup_latitude: store?.latitude ?? null,
        pickup_longitude: store?.longitude ?? null,
        pickup_address: store?.pickup_address ?? null,
        pickup_contact_name: store?.name ?? merchant?.business_name ?? null,
        pickup_contact_phone: merchant?.phone ?? null,
        dropoff_latitude: address?.latitude ?? null,
        dropoff_longitude: address?.longitude ?? null,
        dropoff_address: address ? `${address.line1}, ${address.city}` : null,
        dropoff_contact_name: address?.recipient_name ?? null,
        dropoff_contact_phone: address?.phone ?? null,
      });
      // TODO: notify the Tolo delivery dispatch system (see delivery-dispatch function).
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
