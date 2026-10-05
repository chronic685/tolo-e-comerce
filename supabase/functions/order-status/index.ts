// POST /order-status
// body: { merchant_order_id: string, status: string, note?: string }
// Validates the requested transition, checks the caller is staff of the
// owning merchant (or Tolo staff), applies it, and logs it to
// order_status_history. Reaching "ready_for_pickup" opens a delivery record.
// The transition rules live in transitions.ts (and, for every client write, in migration 0098).
//
// One button per order: a new order goes straight to "processing" in ONE update that also records when it was
// accepted and when preparation started, with both history rows written in one insert, so there is never a
// half-accepted order. Asking for the status an order is already in succeeds without doing anything (a double tap,
// or two screens open), so retrying is always safe.
import { serviceClient, userClient } from "../_shared/client.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { sendNotification } from "../_shared/notify.ts";
import { formatOrderNumber } from "../_shared/format.ts";
import {
  CUSTOMER_TRANSITIONS,
  customerNotificationFor,
  isAcceptAndStart,
  MERCHANT_TRANSITIONS,
  WITH_DRIVER_JOB_STATUSES,
  WITH_DRIVER_ORDER_STATUSES,
} from "./transitions.ts";

// The merchant's phone lives in merchant_private (migration 0095); PostgREST embeds the 1:1 row as an object.
function merchantPhone(merchant: unknown): string | null {
  const row = (merchant as { merchant_private?: { phone?: string | null } | { phone?: string | null }[] | null } | null)?.merchant_private;
  return (Array.isArray(row) ? row[0]?.phone : row?.phone) ?? null;
}

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

    // Already there (a double tap, a retry after a dropped response, two screens open): nothing to do, so no error. Only
    // someone who could have made the change in the first place gets that answer.
    if (mo.status === status) {
      const [{ data: orderOwner }, { data: staffRow }, { data: ownerRow }] = await Promise.all([
        db.from("orders").select("customer_id").eq("id", mo.order_id).single(),
        db.from("merchant_staff").select("id").eq("merchant_id", mo.merchant_id).eq("user_id", userData.user.id).maybeSingle(),
        db.from("merchants").select("id").eq("id", mo.merchant_id).eq("owner_id", userData.user.id).maybeSingle(),
      ]);
      if (orderOwner?.customer_id !== userData.user.id && !staffRow && !ownerRow) {
        return jsonResponse({ error: "Not authorized for this order" }, 403);
      }
      return jsonResponse({ ok: true, unchanged: true, status: mo.status });
    }

    const merchantAllowed = MERCHANT_TRANSITIONS[mo.status] ?? [];
    const customerAllowed = CUSTOMER_TRANSITIONS[mo.status] ?? [];
    if (!merchantAllowed.includes(status) && !customerAllowed.includes(status)) {
      if (status === "cancelled" && WITH_DRIVER_ORDER_STATUSES.includes(mo.status)) {
        return jsonResponse({ error: "This order can no longer be cancelled because a driver has already been assigned to it." }, 400);
      }
      return jsonResponse(
        { error: `Cannot move from ${mo.status} to ${status}` },
        400,
      );
    }

    const { data: orderRow } = await db
      .from("orders")
      .select("customer_id")
      .eq("id", mo.order_id)
      .single();
    // Both the customer and the merchant may cancel from some statuses, so
    // the caller's identity (not just the transition) decides which rules apply.
    const isCustomerAction = customerAllowed.includes(status) && orderRow?.customer_id === userData.user.id;

    if (isCustomerAction) {
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

      // The delivery leg decides, not only the order status: a driver may have
      // accepted the job a moment before anything shows on the order.
      const { data: job } = await db.from("delivery_jobs").select("status").eq("merchant_order_id", mo.id).maybeSingle();
      if (job && WITH_DRIVER_JOB_STATUSES.includes(job.status)) {
        return jsonResponse({ error: "This order can no longer be cancelled because a driver has already been assigned to it." }, 400);
      }
    } else if (!merchantAllowed.includes(status)) {
      return jsonResponse({ error: "Not authorized for this order" }, 403);
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

    // Cancelling after the order is ready: allowed until a driver has accepted the job, whoever cancels.
    if (status === "cancelled" && mo.status === "ready_for_pickup" && !isCustomerAction) {
      const { data: job } = await db.from("delivery_jobs").select("status").eq("merchant_order_id", mo.id).maybeSingle();
      if (job && WITH_DRIVER_JOB_STATUSES.includes(job.status)) {
        return jsonResponse({ error: "This order can no longer be cancelled because a driver has already been assigned to it." }, 400);
      }
    }

    const acceptAndStart = isAcceptAndStart(mo.status, status);
    const update: Record<string, unknown> = { status };
    const now = new Date().toISOString();
    // "accepted" is the spec's "ORDER RECEIVED" acknowledgement — this
    // timestamp, not the notification, is what counts as the merchant
    // having actually seen the order.
    if (status === "accepted" || acceptAndStart) {
      update.order_received_at = now;
      update.received_by = userData.user.id;
    }
    if (status === "processing") update.preparation_started_at = now;
    if (status === "ready_for_pickup") update.ready_for_pickup_at = now;

    // Guarded on the status we validated against, so two simultaneous requests
    // (a double tap, or the driver pickup callback racing a cancel) cannot both
    // win and release stock / open a refund twice.
    const { data: moved } = await db.from("merchant_orders").update(update).eq("id", mo.id).eq("status", mo.status).select("id");
    if (!moved || moved.length === 0) {
      return jsonResponse({ error: "This order's status just changed. Please refresh and try again." }, 409);
    }
    const historyNote = note ?? (isCustomerAction && status === "cancelled" ? "Cancelled by customer" : undefined);
    await db.from("order_status_history").insert(
      acceptAndStart
        ? [
            // The same instant for both: the customer's timeline shows "preparing" from the accept time.
            { merchant_order_id: mo.id, status: "accepted", changed_by: userData.user.id, changed_at: now, note: historyNote },
            { merchant_order_id: mo.id, status: "processing", changed_by: userData.user.id, changed_at: now, note: "Accepted and started preparing" },
          ]
        : [{ merchant_order_id: mo.id, status, changed_by: userData.user.id, note: historyNote }],
    );

    if (status === "rejected" || status === "cancelled") {
      // Gives the stock back and cancels any delivery job/record that nobody has
      // picked up yet (migration 0088). Stock reserved at checkout is only turned
      // into a sale on payment confirmation, so this releases the reservation for
      // an unpaid order and restocks a paid one -- see cancel_order_fulfilment().
      await db.rpc("cancel_order_fulfilment", { p_merchant_order_id: mo.id });

      // Auto-refund (migration 0058): a no-op if the order was never paid
      // (e.g. cash on delivery, still pending) or a refund already exists
      // for this merchant_order -- see refund_merchant_order_if_paid()'s
      // own idempotency check.
      await db.rpc("refund_merchant_order_if_paid", {
        p_merchant_order_id: mo.id,
        p_reason: status === "rejected" ? "Merchant declined the order" : "Order cancelled",
      });
    }

    // One message for accept-and-start; see customerNotificationFor().
    const notifyEvent = customerNotificationFor(mo.status, status);
    if (notifyEvent) {
      const [{ data: orderInfo }, { data: merchantInfo }] = await Promise.all([
        db
          .from("merchant_orders")
          .select("orders!inner(customer_id, order_number)")
          .eq("id", mo.id)
          .single(),
        db.from("merchants").select("business_name").eq("id", mo.merchant_id).single(),
      ]);
      const orderDetails = (orderInfo as unknown as { orders: { customer_id: string; order_number: number } } | null)?.orders;
      if (orderDetails?.customer_id) {
        await sendNotification(db, orderDetails.customer_id, notifyEvent, {
          order_id_short: mo.id.slice(0, 8),
          order_number: formatOrderNumber(orderDetails.order_number),
          merchant_name: merchantInfo?.business_name ?? "the merchant",
        });
      }

      // The customer cancelled: tell the merchant, who may already be preparing it.
      if (isCustomerAction && status === "cancelled") {
        const { data: merchantOwner } = await db.from("merchants").select("owner_id").eq("id", mo.merchant_id).single();
        if (merchantOwner?.owner_id && orderDetails) {
          await sendNotification(db, merchantOwner.owner_id, "order_cancelled_by_customer", {
            order_id_short: mo.id.slice(0, 8),
            order_number: formatOrderNumber(orderDetails.order_number),
          });
        }
      }
    }

    if (status === "ready_for_pickup") {
      // Pickup/dropoff are pulled from records the system already has — the
      // store's own location and the order's delivery address — never asked
      // for again at delivery-creation time (spec: "No Duplicate Data Entry").
      const [{ data: store }, { data: merchant }, { data: orderRow }] = await Promise.all([
        db.from("stores").select("latitude, longitude, pickup_address, name").eq("merchant_id", mo.merchant_id).maybeSingle(),
        db.from("merchants").select("business_name, merchant_private ( phone )").eq("id", mo.merchant_id).single(),
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
        pickup_contact_phone: merchantPhone(merchant),
        dropoff_latitude: address?.latitude ?? null,
        dropoff_longitude: address?.longitude ?? null,
        dropoff_address: address ? `${address.line1}, ${address.city}` : null,
        dropoff_contact_name: address?.recipient_name ?? null,
        dropoff_contact_phone: address?.phone ?? null,
      });

      // Hand the order to the Tolo Delivery app's driver side. A side effect
      // that must never undo or block the status change the merchant just
      // made: delivery-handoff is idempotent and retryable, and records its own
      // failures on the delivery job. The flag is checked HERE, before the
      // call, not only inside delivery-handoff: while the integration is
      // disconnected, an extra Edge Function invocation per ready order would
      // only be spent to be told "skipped".
      if (Deno.env.get("TOLO_DELIVERY_HANDOFF_ENABLED") === "true") {
        try {
          const handoff = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/delivery-handoff`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
            body: JSON.stringify({ merchant_order_id: mo.id }),
            signal: AbortSignal.timeout(15_000),
          });
          if (!handoff.ok) console.error("order-status: delivery-handoff responded with status", handoff.status);
        } catch (err) {
          console.error("order-status: delivery-handoff request failed:", err instanceof Error ? err.message : String(err));
        }
      }
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
