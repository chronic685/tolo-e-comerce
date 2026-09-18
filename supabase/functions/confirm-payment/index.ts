// POST /confirm-payment
// body: { payment_id: string }
// Manual confirmation for payment methods with no automated gateway (cash on
// delivery, bank transfer, mobile money — see _shared/payment_providers.ts).
// The customer's own "it succeeded" claim is never enough (External
// Integrations spec section 14), so this requires a human who can actually
// verify the money moved: the merchant for cash (they physically collect
// it), or Tolo finance for bank/mobile-money transfers (they reconcile
// against the real bank/telco statement).
import { serviceClient, userClient } from "../_shared/client.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { finalizePaymentSuccess } from "../_shared/payment_finalize.ts";

const MERCHANT_CONFIRMABLE_PROVIDERS = new Set(["cash_on_delivery"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authed = userClient(req);
    const { data: userData, error: authError } = await authed.auth.getUser();
    if (authError || !userData?.user) return jsonResponse({ error: "Not authenticated" }, 401);

    const { payment_id } = await req.json();
    if (!payment_id) return jsonResponse({ error: "payment_id is required" }, 400);

    const db = serviceClient();

    const { data: payment } = await db
      .from("payments")
      .select("id, order_id, amount, status, provider")
      .eq("id", payment_id)
      .maybeSingle();

    if (!payment) return jsonResponse({ error: "Payment not found" }, 404);
    if (payment.status === "verified") return jsonResponse({ ok: true, already_processed: true });
    if (payment.status !== "pending") {
      return jsonResponse({ error: `Cannot confirm a payment in status "${payment.status}"` }, 400);
    }

    const { data: profile } = await db.from("profiles").select("role").eq("id", userData.user.id).maybeSingle();
    let authorized = Boolean(profile && ["tolo_finance", "tolo_admin"].includes(profile.role));

    if (!authorized && MERCHANT_CONFIRMABLE_PROVIDERS.has(payment.provider)) {
      const { data: merchantOrders } = await db.from("merchant_orders").select("merchant_id").eq("order_id", payment.order_id);
      for (const mo of merchantOrders ?? []) {
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
        if (membership || owned) {
          authorized = true;
          break;
        }
      }
    }

    if (!authorized) return jsonResponse({ error: "Not authorized to confirm this payment" }, 403);

    await finalizePaymentSuccess(db, payment);
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
