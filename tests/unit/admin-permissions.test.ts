import { afterEach, beforeAll, describe, expect, inject, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { env, serviceClient, signIn } from "../env.ts";

// Migration 0049: per-staff page-level access control. Migration 0050 split
// what used to be a single "super admin = role tolo_admin" concept into two
// real tiers on a new admin_tier column ('admin' | 'super_admin' | null) --
// is_tolo_admin() now means "has either tier" (full access, same as before
// for both), and the narrower is_super_admin() gates only account-level
// management of admin-tier rows themselves. This suite exercises the
// extended prevent_role_self_escalation trigger and the new
// prevent_admin_account_deletion trigger directly via real authenticated
// sessions (not the service role, which bypasses RLS but never bypasses a
// trigger -- see this session's earlier master-login work), since the whole
// point is testing what a given session can and can't do to these columns.
//
// The QA staff fixture (env.qaStaffEmail) was backfilled by migration 0050
// to admin_tier = 'admin' (preserving its pre-migration capability), never
// 'super_admin' -- that tier is a deliberate, one-time, human-confirmed
// designation (see the migration's own comment), not something any fixture
// or test can safely fabricate: admin_tier = 'super_admin' is a real
// structural singleton (a unique index), and the demotion/deletion triggers
// make it permanent once set. Tests that need a genuine super_admin session
// to exercise their positive path look one up dynamically and skip
// gracefully with a console warning if none exists live yet, rather than
// trying to create one.
const db = serviceClient();

function authedClient(token: string) {
  return createClient(env.supabaseUrl, env.anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

describe("admin page permissions and account tiers", () => {
  const createdUserIds: string[] = [];
  let superAdmin: { id: string; email: string } | null = null;

  beforeAll(async () => {
    const { data } = await db.from("profiles").select("id, phone").eq("admin_tier", "super_admin").limit(1).maybeSingle();
    if (data) {
      const { data: authUser } = await db.auth.admin.getUserById(data.id);
      if (authUser?.user?.email) superAdmin = { id: data.id, email: authUser.user.email };
    }
  });

  afterEach(async () => {
    for (const id of createdUserIds.splice(0)) {
      await db.auth.admin.deleteUser(id); // cascades to profiles (on delete cascade)
    }
  });

  const DISPOSABLE_PASSWORD = "qa-test-password-123";

  // Several checks below can only exercise their positive path (the thing a
  // real super_admin CAN do) through a genuine super_admin session -- there
  // is no legitimate way to fabricate one (admin_tier = 'super_admin' is a
  // structural singleton, permanent once set), so this looks for one live
  // and skips gracefully if none exists yet or its password isn't the QA
  // fixture password, rather than trying to create or coerce one.
  async function getSuperAdminClient() {
    if (!superAdmin) {
      console.warn("NOT COVERED: no live super_admin account exists yet -- skipping.");
      return null;
    }
    const token = await signIn(superAdmin.email, env.qaStaffPassword).catch(() => null);
    if (!token) {
      console.warn("NOT COVERED: live super_admin account's password isn't the QA fixture password -- skipping.");
      return null;
    }
    return authedClient(token);
  }

  async function createDisposableStaff(role: string, permissions: string[], adminToken: string) {
    const email = `qa-permtest-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
    const { data, error } = await db.auth.admin.createUser({ email, password: DISPOSABLE_PASSWORD, email_confirm: true });
    expect(error).toBeNull();
    createdUserIds.push(data.user!.id);

    // Promoted through a real admin session (not service role) -- this is
    // the legitimate path, and confirms the "an admin can grant permissions
    // to plain staff" side of the trigger in the same step as fixture setup.
    const admin = authedClient(adminToken);
    const { error: promoteError } = await admin.from("profiles").update({ role, permissions }).eq("id", data.user!.id);
    expect(promoteError).toBeNull();

    return { id: data.user!.id, email };
  }

  it("an admin can grant a plain staff member specific page permissions", async () => {
    const adminToken = await signIn(env.qaStaffEmail, env.qaStaffPassword);
    const { id: staffId } = await createDisposableStaff("tolo_support", ["dashboard", "orders"], adminToken);

    const { data } = await db.from("profiles").select("permissions").eq("id", staffId).single();
    expect(data!.permissions).toEqual(["dashboard", "orders"]);
  });

  it("a non-admin staff member cannot grant themselves additional permissions", async () => {
    const adminToken = await signIn(env.qaStaffEmail, env.qaStaffPassword);
    const email = `qa-permtest-self-${Date.now()}@example.test`;
    const { data: created, error } = await db.auth.admin.createUser({ email, password: "qa-test-password-123", email_confirm: true });
    expect(error).toBeNull();
    createdUserIds.push(created.user!.id);

    const admin = authedClient(adminToken);
    await admin.from("profiles").update({ role: "tolo_support", permissions: ["dashboard"] }).eq("id", created.user!.id);

    // Sign in as the disposable staff member themselves and try to widen
    // their own access -- this is the exact abuse case the task called out:
    // a regular staff member, even with "Users & Roles" access, must not
    // be able to grant themselves new permissions.
    const selfToken = await signIn(email, "qa-test-password-123");
    const self = authedClient(selfToken);
    const { error: selfEscalateError } = await self
      .from("profiles")
      .update({ permissions: ["dashboard", "orders", "payments", "settings"] })
      .eq("id", created.user!.id);

    expect(selfEscalateError).not.toBeNull();
    expect(selfEscalateError!.message).toMatch(/Only an admin or super admin can change platform roles or permissions\./);

    const { data: unchanged } = await db.from("profiles").select("permissions").eq("id", created.user!.id).single();
    expect(unchanged!.permissions).toEqual(["dashboard"]);
  });

  it("a non-admin staff member cannot change another profile's permissions either", async () => {
    const adminToken = await signIn(env.qaStaffEmail, env.qaStaffPassword);
    // "users" access granted deliberately -- this is exactly the case the
    // task called out: having the Users & Roles page open must not be
    // enough to actually grant anyone anything.
    const attacker = await createDisposableStaff("tolo_support", ["users"], adminToken);
    const victim = await createDisposableStaff("tolo_ops", ["dashboard"], adminToken);

    // This case is actually caught one layer earlier than the trigger: the
    // pre-existing profiles_update_own RLS policy (migration 0014) is
    // "id = auth.uid() or is_tolo_admin()", so the attacker's UPDATE never
    // matches the victim's row at all -- no error, just zero rows affected,
    // same as any WHERE clause matching nothing. The trigger this migration
    // adds is what's needed for the self-escalation case above instead,
    // where id = auth.uid() already lets the row through RLS.
    const attackerToken = await signIn(attacker.email, DISPOSABLE_PASSWORD);
    const attackerClient = authedClient(attackerToken);
    const { data: updateResult, error } = await attackerClient
      .from("profiles")
      .update({ permissions: ["dashboard", "orders", "settings"] })
      .eq("id", victim.id)
      .select();

    expect(error).toBeNull();
    expect(updateResult).toEqual([]); // RLS hid the row -- nothing matched, nothing changed

    const { data } = await db.from("profiles").select("permissions").eq("id", victim.id).single();
    expect(data!.permissions).toEqual(["dashboard"]);
  });

  it("only an admin/super admin session (not the service role bypassing RLS) can satisfy the trigger -- confirms this is real column-level enforcement, not just app-layer convention", async () => {
    const email = `qa-permtest-trigger-${Date.now()}@example.test`;
    const { data: created, error } = await db.auth.admin.createUser({ email, password: "qa-test-password-123", email_confirm: true });
    expect(error).toBeNull();
    createdUserIds.push(created.user!.id);
    await db.from("profiles").update({ role: "tolo_support" }).eq("id", created.user!.id);

    // service_role bypasses RLS but not triggers -- is_tolo_admin() reads
    // auth.uid(), which is null under the service role, so this must also
    // be rejected exactly like a real non-admin session would be.
    const { error: serviceRoleError } = await db.from("profiles").update({ permissions: ["settings"] }).eq("id", created.user!.id);
    expect(serviceRoleError).not.toBeNull();
    expect(serviceRoleError!.message).toMatch(/Only an admin or super admin can change platform roles or permissions\./);
  });

  it("a newly promoted staff member defaults to zero page access until an admin grants some", async () => {
    const adminToken = await signIn(env.qaStaffEmail, env.qaStaffPassword);
    const email = `qa-permtest-default-${Date.now()}@example.test`;
    const { data: created, error } = await db.auth.admin.createUser({ email, password: "qa-test-password-123", email_confirm: true });
    expect(error).toBeNull();
    createdUserIds.push(created.user!.id);

    // Promotes role only, deliberately not touching permissions -- this is
    // the "going forward" default the migration's backfill does NOT apply
    // to (that backfill only ever ran once, for staff that already existed
    // at migration time).
    const admin = authedClient(adminToken);
    const { error: promoteError } = await admin.from("profiles").update({ role: "tolo_support" }).eq("id", created.user!.id);
    expect(promoteError).toBeNull();

    const { data } = await db.from("profiles").select("permissions").eq("id", created.user!.id).single();
    expect(data!.permissions).toEqual([]);
  });

  it("an admin (not super admin) cannot edit its own role/permissions -- admin-tier rows, including the admin's own, are only editable by the super admin", async () => {
    // Directly exercises the migration 0050 boundary that distinguishes
    // admin from super admin: "full access to everything, same as super
    // admin day-to-day" except managing admin-tier accounts -- which this
    // trigger treats as including the admin editing their own role/
    // permissions row, not just other admins'. Provable right now without
    // any live super_admin account, since it's the admin-tier BLOCK path.
    const adminToken = await signIn(env.qaStaffEmail, env.qaStaffPassword);
    const fixtures = inject("qaFixtures");
    const { data: adminProfile } = await db.from("profiles").select("id, permissions, admin_tier").eq("id", fixtures.staffUserId).single();
    expect(adminProfile!.admin_tier).toBe("admin"); // sanity: migration 0050's backfill applies to this fixture
    const original = adminProfile!.permissions as string[];
    const admin = authedClient(adminToken);

    const { error } = await admin.from("profiles").update({ permissions: [...original, "__test_marker__"] }).eq("id", adminProfile!.id);
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/Only the super admin can edit an admin-tier account\./);

    const { data: unchanged } = await db.from("profiles").select("permissions").eq("id", adminProfile!.id).single();
    expect(unchanged!.permissions).toEqual(original);
  });

  it("an admin cannot grant admin_tier to another account -- only the super admin can", async () => {
    const adminToken = await signIn(env.qaStaffEmail, env.qaStaffPassword);
    const { id: staffId } = await createDisposableStaff("tolo_support", [], adminToken);

    const admin = authedClient(adminToken);
    const { error } = await admin.from("profiles").update({ admin_tier: "admin" }).eq("id", staffId);
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/Only the super admin can change admin-tier accounts\./);

    const { data } = await db.from("profiles").select("admin_tier").eq("id", staffId).single();
    expect(data!.admin_tier).toBeNull();
  });

  it("the service role cannot grant admin_tier either -- auth.uid() is null, so is_super_admin() is false there too", async () => {
    const email = `qa-permtest-tier-service-${Date.now()}@example.test`;
    const { data: created, error } = await db.auth.admin.createUser({ email, password: "qa-test-password-123", email_confirm: true });
    expect(error).toBeNull();
    createdUserIds.push(created.user!.id);

    const { error: serviceRoleError } = await db.from("profiles").update({ admin_tier: "admin" }).eq("id", created.user!.id);
    expect(serviceRoleError).not.toBeNull();
    expect(serviceRoleError!.message).toMatch(/Only the super admin can change admin-tier accounts\./);
  });

  it("admin_tier = 'super_admin' is a structural singleton -- a second row can never carry it, even via the service role", async () => {
    if (!superAdmin) {
      console.warn("NOT COVERED: no live super_admin account exists yet -- skipping the one-super-admin unique-index check.");
      return;
    }
    const email = `qa-permtest-second-super-${Date.now()}@example.test`;
    const { data: created, error } = await db.auth.admin.createUser({ email, password: "qa-test-password-123", email_confirm: true });
    expect(error).toBeNull();
    createdUserIds.push(created.user!.id);

    // Service role bypasses RLS AND, unlike a real admin session, would
    // fail the trigger's is_super_admin() check too -- but the point of
    // this test is the unique index specifically, so this confirms the
    // index is a real backstop independent of the trigger.
    const { error: secondSuperAdminError } = await db.from("profiles").update({ admin_tier: "super_admin" }).eq("id", created.user!.id);
    expect(secondSuperAdminError).not.toBeNull();
  });

  it("the super admin can edit an admin-tier account's role/permissions (the trigger's allow-path for admin-tier rows)", async () => {
    const superClient = await getSuperAdminClient();
    if (!superClient) return;
    const fixtures = inject("qaFixtures");
    const { data: adminProfile } = await db.from("profiles").select("id, permissions").eq("id", fixtures.staffUserId).single();
    const original = adminProfile!.permissions as string[];

    try {
      const { error } = await superClient.from("profiles").update({ permissions: [...original, "__test_marker__"] }).eq("id", adminProfile!.id);
      expect(error).toBeNull();
      const { data: afterChange } = await db.from("profiles").select("permissions").eq("id", adminProfile!.id).single();
      expect(afterChange!.permissions).toEqual([...original, "__test_marker__"]);
    } finally {
      // Must go through the super admin session: the service role can't edit
      // an admin-tier row's permissions, so a service-role restore here would
      // fail silently and leave the marker on the shared fixture.
      const { error: restoreError } = await superClient.from("profiles").update({ permissions: original }).eq("id", adminProfile!.id);
      expect(restoreError).toBeNull();
    }
  });

  it("the super admin account can never be demoted or deleted, by anyone", async () => {
    if (!superAdmin) {
      console.warn("NOT COVERED: no live super_admin account exists yet -- skipping.");
      return;
    }
    // Service role, not a real session -- demonstrates this holds even
    // against the most privileged caller this schema has, not just a
    // regular admin trying it.
    const { error: demoteError } = await db.from("profiles").update({ admin_tier: "admin" }).eq("id", superAdmin.id);
    expect(demoteError).not.toBeNull();
    expect(demoteError!.message).toMatch(/The super admin account cannot be demoted\./);

    const { error: deleteError } = await db.from("profiles").delete().eq("id", superAdmin.id);
    expect(deleteError).not.toBeNull();
    expect(deleteError!.message).toMatch(/The super admin account cannot be deleted\./);

    const { data: stillThere } = await db.from("profiles").select("admin_tier").eq("id", superAdmin.id).single();
    expect(stillThere!.admin_tier).toBe("super_admin");
  });

  it("an admin cannot delete another admin-tier account -- only the super admin can", async () => {
    // Setting admin_tier at all requires is_super_admin() (proven above),
    // so this fixture can only be set up legitimately -- there's no service-
    // role shortcut, by design.
    const superClient = await getSuperAdminClient();
    if (!superClient) return;

    const adminToken = await signIn(env.qaStaffEmail, env.qaStaffPassword);
    const email = `qa-permtest-admin-delete-${Date.now()}@example.test`;
    const { data: created, error } = await db.auth.admin.createUser({ email, password: "qa-test-password-123", email_confirm: true });
    expect(error).toBeNull();
    createdUserIds.push(created.user!.id);
    await db.from("profiles").update({ role: "tolo_support" }).eq("id", created.user!.id);
    const { error: grantError } = await superClient.from("profiles").update({ admin_tier: "admin" }).eq("id", created.user!.id);
    expect(grantError).toBeNull();

    try {
      const admin = authedClient(adminToken);
      const { error: deleteError } = await admin.from("profiles").delete().eq("id", created.user!.id);
      // RLS on profiles doesn't grant staff a DELETE policy at all (deletion
      // has only ever happened via the service-role Admin API cascading from
      // auth.users) -- so this is expected to affect zero rows rather than
      // raise, and the trigger is what actually protects the Edge-Function
      // path (service role) from removing another admin-tier row.
      expect(deleteError).toBeNull();

      const { error: serviceDeleteError } = await db.from("profiles").delete().eq("id", created.user!.id);
      expect(serviceDeleteError).not.toBeNull();
      expect(serviceDeleteError!.message).toMatch(/Only the super admin can delete an admin-tier account\./);
    } finally {
      // The deletion-protection trigger applies to ANY admin-tier row, which
      // means afterEach's db.auth.admin.deleteUser() (service role, and thus
      // never is_super_admin()) would itself be rejected by the very trigger
      // this test just proved -- demoting back through the super_admin
      // session first is what makes this disposable row cleanable again.
      await superClient.from("profiles").update({ admin_tier: null }).eq("id", created.user!.id);
    }
  });
});
