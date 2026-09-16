// GET /commission-calc?merchant_id=...&category_id=...
// Read-only preview of the commission rate that would apply right now
// (merchant > category > platform > fallback). The authoritative calculation
// happens inside create_order()/get_commission_rate() at checkout time; this
// endpoint just lets the merchant dashboard show an estimate beforehand.
import { serviceClient, userClient } from "../_shared/client.ts";
import { jsonResponse } from "../_shared/cors.ts";
import { resolveCommissionRate } from "../_shared/commission.ts";

Deno.serve(async (req) => {
  try {
    const authed = userClient(req);
    const { data: userData, error: authError } = await authed.auth.getUser();
    if (authError || !userData?.user) return jsonResponse({ error: "Not authenticated" }, 401);

    const url = new URL(req.url);
    const merchantId = url.searchParams.get("merchant_id");
    const categoryId = url.searchParams.get("category_id");
    if (!merchantId) return jsonResponse({ error: "merchant_id is required" }, 400);

    const db = serviceClient();
    const rate = await resolveCommissionRate(db, merchantId, categoryId);

    return jsonResponse({ merchant_id: merchantId, category_id: categoryId, rate_percent: rate });
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
