// POST /merchant-staff-lookup
// body: { phone: string }
// A merchant owner searches for an already-registered account by phone
// number to add as staff — merchant_staff has no invite/pending-account
// concept (just an immediate merchant_id/user_id/role row, migration 0002),
// so the person being added must already have a real account, the same way
// admin-dashboard's Users.tsx searches for an existing account to promote
// to Tolo staff.
//
// This needs an Edge Function rather than a direct client query because
// profiles' own RLS ("profiles_select_own_or_staff": id = auth.uid() or
// is_tolo_staff()) does not let an ordinary merchant read another user's
// profile row at all — a merchant is neither of those for someone else's
// account. Looks the phone up with the service-role client only after
// confirming the caller actually owns a merchant, and returns just the
// minimal fields needed to confirm before adding (id, full_name, phone),
// never the full profile row.
import { serviceClient, userClient } from "../_shared/client.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authed = userClient(req);
    const { data: userData, error: authError } = await authed.auth.getUser();
    if (authError || !userData?.user) return jsonResponse({ error: "Not authenticated" }, 401);

    const { phone } = await req.json();
    if (!phone) return jsonResponse({ error: "phone is required" }, 400);

    const db = serviceClient();

    // Same boundary as merchant_staff's own "merchant_staff_manage" RLS
    // policy (migration 0014): only the merchant's owner can manage staff,
    // not another staff member regardless of their role. Enforced here too
    // — not just relying on the later insert being rejected — so a
    // non-owner can't even learn whether a given phone number has an
    // account on Tolo.
    const { data: merchant } = await db.from("merchants").select("id").eq("owner_id", userData.user.id).maybeSingle();
    if (!merchant) return jsonResponse({ error: "Only a merchant owner can search for staff to add" }, 403);

    const { data: profile } = await db.from("profiles").select("id, full_name, phone").eq("phone", phone).maybeSingle();
    if (!profile) return jsonResponse({ profile: null });

    const { data: existingStaff } = await db
      .from("merchant_staff")
      .select("id")
      .eq("merchant_id", merchant.id)
      .eq("user_id", profile.id)
      .maybeSingle();

    return jsonResponse({ profile, already_staff: Boolean(existingStaff) });
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
