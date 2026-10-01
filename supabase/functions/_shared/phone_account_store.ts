// Database-backed PhoneAccountDeps (see phone_account.ts), shared by
// tolo-app-login and review-merchant-application so both match and create
// Tolo-phone accounts the exact same way.
import type { serviceClient } from "./client.ts";
import type { PhoneAccountDeps } from "./phone_account.ts";

export function phoneAccountStore(db: ReturnType<typeof serviceClient>): PhoneAccountDeps {
  return {
    async findLinkedAccount(phone) {
      const { data, error } = await db.rpc("tolo_account_for_phone", { p_phone: phone }).maybeSingle();
      if (error) throw new Error(`tolo_account_for_phone failed: ${error.message}`);
      return data ? { id: data.user_id as string, isStaffOrAdmin: data.is_staff_or_admin as boolean } : null;
    },

    async createCustomer(phone, name) {
      // Supabase Auth needs an email even for a phone-first signup; this
      // synthetic address is never shown to the customer or usable as a
      // login credential (no password is set) -- same pattern
      // admin-create-staff/index.ts uses for its `${username}@staff.internal`
      // synthetic accounts. It is random, not derived from the phone, so
      // nobody can pre-register it through normal signup to block a
      // phone's first Tolo login. The phone is deliberately NOT set on
      // the auth user either: tolo_phone_links is the one place it is
      // trusted from.
      const email = `tolo-${crypto.randomUUID()}@app.tolo.internal`;
      const { data: created, error } = await db.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { full_name: name },
      });
      if (error || !created?.user) {
        throw new Error("Could not create customer account.");
      }
      // handle_new_user() (migration 0001) already created the profiles
      // row with full_name set. profiles.phone is filled in for display
      // only (the customer may edit it later); it's never used to match.
      const { error: profileError } = await db.from("profiles").update({ phone }).eq("id", created.user.id);
      const { error: linkError } = profileError
        ? { error: profileError }
        : await db.rpc("link_tolo_phone", { p_user_id: created.user.id, p_phone: phone });
      if (linkError) {
        // Includes losing a race with a concurrent first login for the
        // same phone: discard this account; a retry matches the winner.
        await db.auth.admin.deleteUser(created.user.id);
        throw new Error("Could not create customer account.");
      }
      return { id: created.user.id };
    },

    async recordLogin(id) {
      await db.rpc("record_tolo_login", { p_user_id: id });
    },
  };
}
