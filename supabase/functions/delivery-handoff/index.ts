// POST /delivery-handoff
// Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
// body: { merchant_order_id: string }
//
// Internal: order-status calls this when a merchant marks an order ready for
// pickup. Creates the order's delivery job (idempotent) and sends the
// delivery payload to the Tolo Delivery app, which is a stub/mock until that
// backend exists. Calling it again for an order whose handoff failed retries
// it; for one that was acknowledged it does nothing. Contract:
// docs/integration/delivery-handoff.md.
//
// Does nothing at all unless TOLO_DELIVERY_HANDOFF_ENABLED=true.
//
// Deployed with JWT verification off (supabase/config.toml) so the check
// doesn't depend on which key format the project issues; the service-role
// key compared below is the only gate, and a user/anon token never matches.
import { serviceClient } from "../_shared/client.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import {
  attributeOrderLevelCharges,
  handleHandoff,
  sendToToloDelivery,
  type HandoffDeps,
  type OrderFacts,
} from "./logic.ts";

const num = (v: unknown): number => Number(v ?? 0);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  try {
    const db = serviceClient();

    const deps: HandoffDeps = {
      async loadFacts(merchantOrderId) {
        const { data: mo } = await db
          .from("merchant_orders")
          .select("id, order_id, merchant_id, status, subtotal, discount_amount")
          .eq("id", merchantOrderId)
          .maybeSingle();
        if (!mo) return null;

        const [{ data: order }, { data: siblings }, { data: items }, { data: store }, { data: merchant }] = await Promise.all([
          db
            .from("orders")
            .select(
              "order_number, customer_id, payment_status, delivery_fee, rider_tip, addresses(recipient_name, line1, city, latitude, longitude), payments(provider, created_at)",
            )
            .eq("id", mo.order_id)
            .single(),
          db.from("merchant_orders").select("id, subtotal, status").eq("order_id", mo.order_id).order("created_at").order("id"),
          db.from("order_items").select("product_name_snapshot, quantity").eq("merchant_order_id", mo.id).eq("item_status", "active"),
          db.from("stores").select("name, latitude, longitude, pickup_address").eq("merchant_id", mo.merchant_id).maybeSingle(),
          db.from("merchants").select("business_name, phone").eq("id", mo.merchant_id).single(),
        ]);
        if (!order) return null;

        const address = (order as unknown as { addresses: Record<string, unknown> | null }).addresses;
        const payments = ((order as unknown as { payments: { provider: string; created_at: string }[] }).payments ?? [])
          .slice()
          .sort((a, b) => b.created_at.localeCompare(a.created_at));

        // The phone the customer signed in to Tolo with -- never the
        // self-editable profiles.phone (see docs/integration/tolo-app.md).
        const { data: link } = await db.from("tolo_phone_links").select("phone").eq("user_id", order.customer_id).maybeSingle();

        const charges = attributeOrderLevelCharges(
          mo.id,
          // Rejected/cancelled shops send no driver, so they take no share.
          (siblings ?? [])
            .filter((s) => s.id === mo.id || !["rejected", "cancelled"].includes(s.status as string))
            .map((s) => ({ id: s.id as string, subtotal: num(s.subtotal) })),
          { deliveryFee: num(order.delivery_fee), riderTip: num(order.rider_tip) },
        );

        const facts: OrderFacts = {
          merchantOrderId: mo.id,
          status: mo.status,
          orderNumber: order.order_number,
          orderPaymentStatus: order.payment_status,
          paymentProviders: payments.map((p) => p.provider),
          itemSubtotal: num(mo.subtotal),
          discount: num(mo.discount_amount),
          deliveryFee: charges.deliveryFee,
          riderTip: charges.riderTip,
          items: (items ?? []).map((i) => ({ name: i.product_name_snapshot as string, quantity: i.quantity as number })),
          pickup: {
            name: store?.name ?? merchant?.business_name ?? null,
            address: store?.pickup_address ?? null,
            latitude: store?.latitude ?? null,
            longitude: store?.longitude ?? null,
            phone: merchant?.phone ?? null,
          },
          dropoff: {
            name: (address?.recipient_name as string | undefined) ?? null,
            address: address ? `${address.line1}, ${address.city}` : null,
            latitude: (address?.latitude as number | null | undefined) ?? null,
            longitude: (address?.longitude as number | null | undefined) ?? null,
            verifiedPhone: link?.phone ?? null,
          },
        };
        return facts;
      },

      async getOrCreateJob(merchantOrderId) {
        // ignoreDuplicates: a concurrent/second call keeps the existing row.
        await db.from("delivery_jobs").upsert({ merchant_order_id: merchantOrderId }, { onConflict: "merchant_order_id", ignoreDuplicates: true });
        const { data, error } = await db.from("delivery_jobs").select("id, dispatched_at").eq("merchant_order_id", merchantOrderId).single();
        if (error || !data) throw new Error(`delivery_jobs lookup failed: ${error?.message ?? "no row"}`);
        return data;
      },

      async recordAttempt(jobId, outcome) {
        const { data } = await db.from("delivery_jobs").select("handoff_attempts").eq("id", jobId).single();
        await db
          .from("delivery_jobs")
          .update({
            handoff_attempts: (data?.handoff_attempts ?? 0) + 1,
            handoff_error: outcome.ok ? null : outcome.error,
            needs_manual_handling: outcome.ok ? false : (outcome.manual ?? false),
            ...(outcome.ok ? { dispatched_at: new Date().toISOString() } : {}),
          })
          .eq("id", jobId);
      },

      send: (payload) =>
        sendToToloDelivery(payload, {
          baseUrl: Deno.env.get("TOLO_BACKEND_URL"),
          sharedKey: Deno.env.get("TOLO_BACKEND_SHARED_KEY"),
        }),
    };

    const result = await handleHandoff(
      {
        authorization: req.headers.get("Authorization"),
        expectedKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
        enabled: Deno.env.get("TOLO_DELIVERY_HANDOFF_ENABLED") === "true",
        body: await req.json().catch(() => null),
      },
      deps,
    );
    return jsonResponse(result.body, result.status);
  } catch (err) {
    // Never log the payload (phones) or any key.
    console.error("delivery-handoff failed:", err instanceof Error ? err.message : String(err));
    return jsonResponse({ error: "Handoff failed." }, 500);
  }
});
