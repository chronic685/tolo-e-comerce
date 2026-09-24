// POST /admin-set-account-status
// body: { user_id, status: "suspended" | "active", reason? }
// Suspend/reactivate an account as a real kill switch. Suspension already
// cuts platform data at once through RLS (every staff check requires
// account_status = 'active'); this also bans the account in Supabase Auth,
// so it can't sign in again or refresh its session. Reactivating lifts the
// ban. The ban is a service-role Admin API call, hence the Edge Function.
//
// Same rules as the other account actions: active admin or super admin
// only, never your own account, never the super admin, and admin-tier
// accounts only by the super admin.
import { serviceClient, userClient } from "../_shared/client.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

// Supabase Auth takes a duration, not "forever": 100 years.
const BAN_FOREVER = "876000h";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authed = userClient(req);
    const { data: userData, error: authError } = await authed.auth.getUser();
    if (authError || !userData?.user) return jsonResponse({ error: "Not authenticated" }, 401);

    const { user_id, status, reason } = await req.json();
    if (!user_id || (status !== "suspended" && status !== "active")) {
      return jsonResponse({ error: "user_id and status ('suspended' or 'active') are required" }, 400);
    }

    const db = serviceClient();

    const { data: caller } = await db
      .from("profiles")
      .select("admin_tier, account_status")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (!caller?.admin_tier || caller.account_status !== "active") {
      return jsonResponse({ error: "Only an active admin or super admin can suspend or reactivate accounts." }, 403);
    }
    if (user_id === userData.user.id) {
      return jsonResponse({ error: "You can't suspend or reactivate your own account." }, 403);
    }

    const { data: target } = await db.from("profiles").select("admin_tier").eq("id", user_id).maybeSingle();
    if (!target) return jsonResponse({ error: "Account not found." }, 404);
    if (target.admin_tier === "super_admin") {
      return jsonResponse({ error: "The super admin account can't be suspended." }, 403);
    }
    if (target.admin_tier === "admin" && caller.admin_tier !== "super_admin") {
      return jsonResponse({ error: "Only the super admin can suspend or reactivate an admin-tier account." }, 403);
    }

    // The profile change goes through the caller's own session so the
    // audit log records who did it and the status trigger applies as usual.
    const profileUpdate =
      status === "suspended"
        ? { account_status: "suspended", suspension_reason: reason ? String(reason) : null }
        : { account_status: "active", suspension_reason: null };

    if (status === "suspended") {
      // Cut data access first (RLS), then block new sign-ins and refreshes.
      const { error: profileError } = await authed.from("profiles").update(profileUpdate).eq("id", user_id);
      if (profileError) return jsonResponse({ error: profileError.message }, 400);
      const { error: banError } = await db.auth.admin.updateUserById(user_id, { ban_duration: BAN_FOREVER });
      if (banError) {
        // Left suspended on purpose: data access is already cut, which is
        // the part that matters most. Report so it can be retried.
        return jsonResponse({ error: `Suspended, but the sign-in ban failed: ${banError.message}` }, 500);
      }
    } else {
      const { error: unbanError } = await db.auth.admin.updateUserById(user_id, { ban_duration: "none" });
      if (unbanError) return jsonResponse({ error: unbanError.message }, 400);
      const { error: profileError } = await authed.from("profiles").update(profileUpdate).eq("id", user_id);
      if (profileError) {
        await db.auth.admin.updateUserById(user_id, { ban_duration: BAN_FOREVER });
        return jsonResponse({ error: profileError.message }, 400);
      }
    }

    return jsonResponse({ ok: true, status });
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
