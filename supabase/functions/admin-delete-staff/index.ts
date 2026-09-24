// POST /admin-delete-staff
// body: { user_id }
// Deletes an admin-panel account entirely, not just its profiles row --
// auth.admin.deleteUser() invalidates the account's refresh tokens
// immediately (nothing can extend their session past whatever's left of
// its current, short-lived access token) and cascades to remove the
// profiles row too (on delete cascade, migration 0001). Needs an Edge
// Function because deleteUser() is a service-role-only Admin API call.
//
// The rules below are checked here first for a clean error message, but
// migration 0050's prevent_admin_account_deletion trigger is the real
// backstop: it fires on this exact delete (including the cascade from
// auth.users) regardless of what calls it, so a bug here could never
// actually delete the super admin or an admin-tier account -- the whole
// deleting transaction rolls back if it tries.
//
// That backstop has no caller identity under the Admin API (auth.uid() is
// null there), so it rejects EVERY admin-tier delete, including the super
// admin's legitimate one. For that case the target's admin_tier is cleared
// first through the super admin's own session (the trigger sees a real
// is_super_admin() caller and allows it), and only then is the now-plain
// account deleted.
import { serviceClient, userClient } from "../_shared/client.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authed = userClient(req);
    const { data: userData, error: authError } = await authed.auth.getUser();
    if (authError || !userData?.user) return jsonResponse({ error: "Not authenticated" }, 401);

    const { user_id } = await req.json();
    if (!user_id) return jsonResponse({ error: "user_id is required" }, 400);

    const db = serviceClient();

    const { data: caller } = await db
      .from("profiles")
      .select("admin_tier, account_status")
      .eq("id", userData.user.id)
      .maybeSingle();
    // account_status matches is_tolo_admin()'s own definition -- a suspended
    // admin's still-valid token must not be able to delete anyone, and for a
    // plain-staff target there is no trigger to catch it.
    if (!caller?.admin_tier || caller.account_status !== "active") {
      return jsonResponse({ error: "Only an active admin or super admin can delete staff accounts." }, 403);
    }

    const { data: target } = await db.from("profiles").select("admin_tier").eq("id", user_id).maybeSingle();
    if (!target) return jsonResponse({ error: "Account not found." }, 404);

    if (target.admin_tier === "super_admin") {
      return jsonResponse({ error: "The super admin account cannot be deleted." }, 403);
    }
    if (target.admin_tier === "admin" && caller.admin_tier !== "super_admin") {
      return jsonResponse({ error: "Only the super admin can delete an admin-tier account." }, 403);
    }

    if (target.admin_tier === "admin") {
      const { error: demoteError } = await authed.from("profiles").update({ admin_tier: null }).eq("id", user_id);
      if (demoteError) return jsonResponse({ error: demoteError.message }, 400);
    }

    const { error: deleteError } = await db.auth.admin.deleteUser(user_id);
    if (deleteError) {
      if (target.admin_tier === "admin") {
        await authed.from("profiles").update({ admin_tier: "admin" }).eq("id", user_id);
      }
      return jsonResponse({ error: deleteError.message }, 400);
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
