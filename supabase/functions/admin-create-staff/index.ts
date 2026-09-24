// POST /admin-create-staff
// body: { username, password, full_name?, role, permissions?, admin_tier? }
// Creates a new admin-panel account directly (no self-signup, no email
// invite) -- username+password only, per the task. Needs an Edge Function
// because auth.admin.createUser() is a service-role-only Admin API call no
// client session can make. The actual profiles row (role/permissions/
// admin_tier/username) is then set through the CALLING admin's own
// session, not service role -- migration 0050's prevent_role_self_escalation
// trigger reads auth.uid() to know who's making the change, which is null
// under the service role (the same bootstrapping issue this session hit
// with the very first admin promotion, solved the same way here).
import { serviceClient, userClient } from "../_shared/client.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

// No '@' allowed -- this becomes the local part of a synthetic
// {username}@staff.internal email (see below), so anything that could
// collide with real-email syntax is rejected up front.
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,30}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authed = userClient(req);
    const { data: userData, error: authError } = await authed.auth.getUser();
    if (authError || !userData?.user) return jsonResponse({ error: "Not authenticated" }, 401);

    const { username, password, full_name, role, permissions, admin_tier } = await req.json();
    if (!username || !password || !role) {
      return jsonResponse({ error: "username, password, and role are required" }, 400);
    }
    if (!USERNAME_RE.test(String(username).toLowerCase())) {
      return jsonResponse({ error: "Username must be 3-31 characters: lowercase letters, numbers, dot, dash, or underscore." }, 400);
    }
    if (String(password).length < 8) {
      return jsonResponse({ error: "Password must be at least 8 characters." }, 400);
    }
    if (admin_tier && admin_tier !== "admin") {
      // super_admin is never created through this form -- see the report
      // on how the one super admin account is designated.
      return jsonResponse({ error: "Invalid admin_tier." }, 400);
    }

    const db = serviceClient();
    const username_normalized = String(username).toLowerCase();

    // Same boundary the DB trigger enforces either way -- checked here
    // first so a non-admin (or a plain admin trying to grant admin_tier)
    // gets a clean error instead of a raw Postgres exception surfacing
    // from the profile update below.
    const { data: caller } = await db
      .from("profiles")
      .select("admin_tier, account_status")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (!caller?.admin_tier || caller.account_status !== "active") {
      return jsonResponse({ error: "Only an active admin or super admin can create staff accounts." }, 403);
    }
    if (admin_tier && caller.admin_tier !== "super_admin") {
      return jsonResponse({ error: "Only the super admin can create admin-tier accounts." }, 403);
    }

    const email = `${username_normalized}@staff.internal`;
    const { data: created, error: createError } = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: full_name || null },
    });
    if (createError) {
      // createUser's own error already distinguishes "already registered"
      // etc. -- it's already written for a human, passed through as-is.
      return jsonResponse({ error: createError.message }, 400);
    }

    // Through the CALLING admin's own session (see file comment above).
    const { error: profileError } = await authed
      .from("profiles")
      .update({
        role,
        permissions: permissions ?? [],
        admin_tier: admin_tier ?? null,
        username: username_normalized,
        full_name: full_name || null,
      })
      .eq("id", created.user!.id);

    if (profileError) {
      // Roll back the auth user rather than leaving a half-created account
      // with no usable staff row and no way for an admin to see or fix it.
      await db.auth.admin.deleteUser(created.user!.id);
      return jsonResponse({ error: profileError.message }, 400);
    }

    return jsonResponse({ id: created.user!.id, username: username_normalized });
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
