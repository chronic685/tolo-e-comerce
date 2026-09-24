// POST /admin-update-staff
// body: { user_id, username?, password? }
// Renames a username account and/or sets a new password for another staff
// account. Needs an Edge Function because both change the auth.users row
// (the {username}@staff.internal login email, the password), which only the
// service-role Admin API can do.
//
// Who may edit whom -- the same rules as admin-delete-staff:
//   - the caller must be an active admin or super admin;
//   - nobody edits their own row here (the Change password page covers
//     that, and requires the current password);
//   - the super admin row is never editable;
//   - an admin-tier row is editable only by the super admin.
// None of this is backed by a DB trigger (username and password aren't
// guarded columns), so these checks are the enforcement, not a convenience.
import { serviceClient, userClient } from "../_shared/client.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

// Same rule as admin-create-staff -- keep in sync.
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,30}$/;
const SYNTHETIC_DOMAIN = "@staff.internal";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authed = userClient(req);
    const { data: userData, error: authError } = await authed.auth.getUser();
    if (authError || !userData?.user) return jsonResponse({ error: "Not authenticated" }, 401);

    const { user_id, username, password } = await req.json();
    if (!user_id) return jsonResponse({ error: "user_id is required" }, 400);
    if (username === undefined && password === undefined) {
      return jsonResponse({ error: "Nothing to change: send a username, a password, or both." }, 400);
    }

    const db = serviceClient();

    const { data: caller } = await db
      .from("profiles")
      .select("admin_tier, account_status")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (!caller?.admin_tier || caller.account_status !== "active") {
      return jsonResponse({ error: "Only an active admin or super admin can edit staff accounts." }, 403);
    }
    if (user_id === userData.user.id) {
      return jsonResponse({ error: "Use the Change password page for your own account." }, 403);
    }

    const { data: target } = await db
      .from("profiles")
      .select("role, admin_tier, username")
      .eq("id", user_id)
      .maybeSingle();
    if (!target) return jsonResponse({ error: "Account not found." }, 404);
    if (!target.admin_tier && !String(target.role).startsWith("tolo_")) {
      return jsonResponse({ error: "Only staff accounts can be edited here." }, 403);
    }
    if (target.admin_tier === "super_admin") {
      return jsonResponse({ error: "The super admin account can't be edited here." }, 403);
    }
    if (target.admin_tier === "admin" && caller.admin_tier !== "super_admin") {
      return jsonResponse({ error: "Only the super admin can edit an admin-tier account." }, 403);
    }

    const authUpdate: { email?: string; email_confirm?: boolean; password?: string } = {};
    let newUsername: string | null = null;

    if (username !== undefined) {
      // Accounts that sign in with a real email have no username; giving
      // them one would replace that email login (and their email-based
      // password reset) with a synthetic address.
      const { data: authUser } = await db.auth.admin.getUserById(user_id);
      if (!target.username || !authUser?.user?.email?.endsWith(SYNTHETIC_DOMAIN)) {
        return jsonResponse({ error: "This account signs in with an email address, not a username." }, 400);
      }
      newUsername = String(username).trim().toLowerCase();
      if (!USERNAME_RE.test(newUsername)) {
        return jsonResponse({ error: "Username must be 3-31 characters: lowercase letters, numbers, dot, dash, or underscore." }, 400);
      }
      if (newUsername === target.username) {
        newUsername = null; // unchanged -- nothing to do for this part
      } else {
        const { data: taken } = await db.from("profiles").select("id").eq("username", newUsername).maybeSingle();
        if (taken) return jsonResponse({ error: `The username "${newUsername}" is already taken.` }, 409);
        authUpdate.email = `${newUsername}${SYNTHETIC_DOMAIN}`;
        authUpdate.email_confirm = true; // no inbox behind it -- never send a confirmation
      }
    }

    if (password !== undefined) {
      if (String(password).length < 8) return jsonResponse({ error: "Password must be at least 8 characters." }, 400);
      authUpdate.password = String(password);
    }

    if (Object.keys(authUpdate).length === 0) return jsonResponse({ ok: true, username: target.username });

    const { error: authUpdateError } = await db.auth.admin.updateUserById(user_id, authUpdate);
    if (authUpdateError) return jsonResponse({ error: authUpdateError.message }, 400);

    if (newUsername) {
      const { error: profileError } = await db.from("profiles").update({ username: newUsername }).eq("id", user_id);
      if (profileError) {
        // Put the login email back so profiles.username and the email that
        // actually signs in never disagree.
        await db.auth.admin.updateUserById(user_id, {
          email: `${target.username}${SYNTHETIC_DOMAIN}`,
          email_confirm: true,
        });
        return jsonResponse({ error: profileError.message }, 400);
      }
    }

    return jsonResponse({ ok: true, username: newUsername ?? target.username });
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
