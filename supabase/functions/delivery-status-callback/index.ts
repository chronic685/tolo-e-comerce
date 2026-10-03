// POST /delivery-status-callback
// Authorization: Bearer <TOLO_BACKEND_INBOUND_KEY>
// body: { job_id, status: "accepted"|"picked_up"|"delivered"|"failed",
//         driver_ref?, eta_minutes?, failure_reason? }
//
// Server-to-server, called by the Tolo Delivery app as a delivery job
// progresses. Updates the job and the order the customer sees
// (apply_delivery_job_update, migration 0080). Contract:
// docs/integration/delivery-handoff.md.
//
// Deployed with JWT verification off (supabase/config.toml) since the
// caller holds no Supabase JWT; the shared key above is the only gate.
import { serviceClient } from "../_shared/client.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { sendNotification } from "../_shared/notify.ts";
import { formatOrderNumber } from "../_shared/format.ts";
import { handleCallback } from "./logic.ts";

const TOLO_BACKEND_INBOUND_KEY = Deno.env.get("TOLO_BACKEND_INBOUND_KEY");

// Same template-driven events delivery-dispatch uses for these two statuses.
const NOTIFY_EVENTS: Record<string, string> = { picked_up: "order_picked_up", delivered: "order_delivered" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  try {
    const db = serviceClient();
    const result = await handleCallback(
      {
        authorization: req.headers.get("Authorization"),
        expectedKey: TOLO_BACKEND_INBOUND_KEY,
        body: await req.json().catch(() => null),
      },
      {
        async apply(update) {
          const { data, error } = await db
            .rpc("apply_delivery_job_update", {
              p_job_id: update.jobId,
              p_status: update.status,
              p_driver_ref: update.driverRef,
              p_eta_minutes: update.etaMinutes,
              p_failure_reason: update.failureReason,
            })
            .single();
          if (error || !data) throw new Error(error?.message ?? "no row");
          const row = data as { outcome: "applied" | "unchanged"; merchant_order_id: string };
          return { outcome: row.outcome, merchantOrderId: row.merchant_order_id };
        },

        async afterApplied(update, merchantOrderId) {
          const event = NOTIFY_EVENTS[update.status];
          if (!event) return;
          const { data: mo } = await db
            .from("merchant_orders")
            .select("status, merchants(business_name), orders!inner(customer_id, order_number)")
            .eq("id", merchantOrderId)
            .single();
          const row = mo as unknown as {
            status: string;
            merchants: { business_name: string } | null;
            orders: { customer_id: string; order_number: number };
          } | null;
          // The order only moves while it's still in the delivery leg: a
          // cancelled order's late callback shouldn't tell the customer
          // their order was delivered.
          const moved = update.status === "picked_up" ? row?.status === "picked_up" : row?.status === "completed";
          if (!row || !moved) return;
          await sendNotification(db, row.orders.customer_id, event, {
            order_id_short: merchantOrderId.slice(0, 8),
            order_number: formatOrderNumber(row.orders.order_number),
            merchant_name: row.merchants?.business_name ?? "the merchant",
          });
        },
      },
    );
    return jsonResponse(result.body, result.status);
  } catch (err) {
    console.error("delivery-status-callback failed:", err instanceof Error ? err.message : String(err));
    return jsonResponse({ error: "Callback failed." }, 500);
  }
});
