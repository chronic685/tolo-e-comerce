// GET /commission-calc?merchant_id=...&category_id=...
// Read-only preview of the commission rate that would apply right now
// (merchant > category > platform > fallback) — calls the exact same
// get_commission_rate() Postgres function create_order() uses at checkout
// time, so this preview can never silently drift from the real calculation.
import { serviceClient, userClient } from "../_shared/client.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authed = userClient(req);
    const { data: userData, error: authError } = await authed.auth.getUser();
    if (authError || !userData?.user) return jsonResponse({ error: "Not authenticated" }, 401);

    const url = new URL(req.url);
    const merchantId = url.searchParams.get("merchant_id");
    const categoryId = url.searchParams.get("category_id");
    if (!merchantId) return jsonResponse({ error: "merchant_id is required" }, 400);

    const db = serviceClient();
    const { data: rate, error: rateError } = await db.rpc("get_commission_rate", {
      p_merchant_id: merchantId,
      p_category_id: categoryId,
    });
    if (rateError) return jsonResponse({ error: rateError.message }, 400);

    return jsonResponse({ merchant_id: merchantId, category_id: categoryId, rate_percent: Number(rate) });
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
