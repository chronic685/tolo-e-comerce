// POST /merchant-application-status
// Authorization: Bearer <TOLO_BACKEND_INBOUND_KEY>
// body: { phone: string }
//
// Server-to-server, called by the Tolo backend (never the app itself --
// the key must not ship in a mobile binary) to decide whether the Tolo app
// shows its "Merchant" button, and to show an application's progress.
// Pull-based on purpose: approval can happen hours after the applicant
// left the WebView, so nothing here assumes they're watching. Contract:
// docs/integration/tolo-app.md.
//
// Deployed with JWT verification off (supabase/config.toml) since the
// caller holds no Supabase JWT; the shared key above is the only gate.
import { serviceClient } from "../_shared/client.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { handleStatus, type PhoneStatusRow } from "./logic.ts";

const TOLO_BACKEND_INBOUND_KEY = Deno.env.get("TOLO_BACKEND_INBOUND_KEY");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  try {
    const db = serviceClient();
    const result = await handleStatus(
      {
        authorization: req.headers.get("Authorization"),
        expectedKey: TOLO_BACKEND_INBOUND_KEY,
        body: await req.json().catch(() => null),
      },
      {
        async lookup(phone) {
          const { data, error } = await db.rpc("merchant_status_for_phone", { p_phone: phone }).single();
          if (error || !data) throw new Error(`merchant_status_for_phone failed: ${error?.message ?? "no row"}`);
          return data as PhoneStatusRow;
        },
      },
    );
    if (!result.ok) return jsonResponse({ error: result.error }, result.status);
    return jsonResponse(result.body);
  } catch (err) {
    // Never log the phone or the key.
    console.error("merchant-application-status failed:", err instanceof Error ? err.message : String(err));
    return jsonResponse({ error: "Status lookup failed." }, 500);
  }
});
