-- Three-tier admin-panel accounts (super admin / admin / staff) and
-- username+password account creation, on top of migration 0049's
-- page-permission system. Checked first, per the task's instruction: that
-- migration reused role = 'tolo_admin' as the one "super" tier, with
-- everything else limited by the new permissions checklist. This migration
-- splits that single tier into two (admin, super admin) via a NEW column
-- rather than overloading `role` further -- `role` (tolo_ops/tolo_finance/
-- tolo_marketing/tolo_support/tolo_merchant_verification/tolo_admin) stays
-- what it always was, a department/job-function label, and now genuinely
-- carries no privilege of its own -- `admin_tier` is what does.
--
-- 1. Schema ------------------------------------------------------------
alter table profiles add column admin_tier text check (admin_tier in ('admin', 'super_admin'));

-- "Exactly one super admin" is a structural invariant per the task, not
-- just a starting condition -- enforced the same way this schema enforces
-- any other true singleton/uniqueness rule (a real constraint, not
-- something left for application code to remember). Every row with
-- admin_tier = 'super_admin' indexes to the same expression value, so a
-- second one violates this unique index outright.
create unique index idx_profiles_one_super_admin on profiles ((admin_tier)) where admin_tier = 'super_admin';

-- Preserves existing capability across this migration, exactly like
-- migration 0049's permissions backfill did for the account-role trigger:
-- is_tolo_admin() is about to change meaning below (from "role =
-- 'tolo_admin'" to "admin_tier is not null"), and without this, whoever
-- currently satisfies the OLD definition would silently lose everything it
-- already gated (system_settings, audit_logs, discount_rules, role/
-- permission/status changes) the instant this ships, with no account left
-- that could grant it back. 'admin' (not 'super_admin') -- this is safe to
-- apply to every such row regardless of how many exist, since 'admin'
-- isn't a singleton the way 'super_admin' is. This does NOT designate a
-- super admin; see the report for how that one account gets chosen.
update profiles set admin_tier = 'admin' where role = 'tolo_admin' and admin_tier is null;

-- Nullable+unique, same pattern as referral_code/discount code -- only
-- accounts created directly through the new "username + password, no
-- email" flow get one; every pre-existing account keeps logging in with
-- its real email exactly as before (see admin-dashboard/src/pages/Login.tsx).
alter table profiles add column username text;
create unique index idx_profiles_username on profiles(username) where username is not null;

-- 2. is_tolo_admin() now means "has an admin tier" instead of
-- "role = 'tolo_admin'" ------------------------------------------------
-- is_tolo_admin() is a centralized helper, not an inline role check, used
-- by every existing admin-only policy/trigger in this schema
-- (profiles_update_own, prevent_role_self_escalation, prevent_status_
-- self_change, system_settings_manage_admin, audit_logs_select_admin,
-- discount_rules_manage, discount_targets_manage, notification_templates_
-- manage -- confirmed via a repo-wide grep before writing this). Redefining
-- it here is what makes "Admin -- full access to everything, same as super
-- admin day-to-day" true everywhere at once, with no other migration
-- touched -- exactly the reason these checks were centralized into a
-- function in the first place (migration 0013), rather than being
-- something to work around.
create or replace function is_tolo_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and account_status = 'active' and admin_tier is not null
  );
$$;

-- Narrower than is_tolo_admin(): only true for the one super admin tier.
-- Used exclusively for the one thing that distinguishes admin from super
-- admin -- managing admin-tier accounts themselves (creating, deleting,
-- promoting/demoting). Every other admin-only check in this schema
-- deliberately keeps using is_tolo_admin(), which is now true for both
-- tiers, so "full access to everything, same as super admin day-to-day"
-- holds everywhere except this one boundary.
create or replace function is_super_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and account_status = 'active' and admin_tier = 'super_admin'
  );
$$;

-- Unlike is_tolo_admin(), this is never referenced in an RLS policy
-- (only inside the two trigger functions below) -- the frontend derives
-- isSuperAdmin client-side from profiles.admin_tier, already readable
-- under existing RLS (profiles_select_own_or_staff), so there's no
-- legitimate direct caller. Same least-privilege reasoning migration 0035
-- already applied to haversine_km.
revoke execute on function is_super_admin() from public, anon, authenticated;

-- 3. Guard admin_tier changes + protect the super admin -----------------
-- Extends the existing role/permissions guard (migration 0013, 0049)
-- rather than adding a third trigger on the same table for the same class
-- of problem. Three rules, in order:
--   - Once a row is admin_tier = 'super_admin', admin_tier can never
--     change again -- not by another admin, not by that account itself.
--     This is what "can never be demoted by anyone" means at the DB level.
--   - Changing admin_tier at all (granting admin, granting super_admin, or
--     demoting an existing admin) requires is_super_admin() -- a regular
--     admin can promote no one to admin tier, per spec ("only the super
--     admin manages accounts at the admin level").
--   - role/permissions changes on a row that is ALREADY admin-tier also
--     require is_super_admin() -- a regular admin cannot "edit another
--     admin or the super admin account" at all, not just admin_tier
--     itself. A plain staff row (admin_tier is and stays null) keeps the
--     exact pre-existing behavior: any is_tolo_admin() holder may change it.
create or replace function prevent_role_self_escalation()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if old.admin_tier = 'super_admin' and new.admin_tier is distinct from old.admin_tier then
    raise exception 'The super admin account cannot be demoted.';
  end if;

  if new.admin_tier is distinct from old.admin_tier and not is_super_admin() then
    raise exception 'Only the super admin can change admin-tier accounts.';
  end if;

  if new.role <> old.role or new.permissions <> old.permissions then
    if old.admin_tier is not null and not is_super_admin() then
      raise exception 'Only the super admin can edit an admin-tier account.';
    elsif old.admin_tier is null and not is_tolo_admin() then
      raise exception 'Only an admin or super admin can change platform roles or permissions.';
    end if;
  end if;

  return new;
end;
$$;

-- 4. Protect against deletion, including via auth.users cascading into
-- profiles (on delete cascade, migration 0001) -- this fires for that
-- cascade too, since triggers run for any DELETE regardless of what
-- triggered it, so even the service-role Admin API used by the new
-- account-deletion Edge Function (below) cannot remove the super admin's
-- row: the whole deleting transaction, including the auth.users row
-- itself, gets rolled back if this raises. Same reasoning extends to any
-- admin-tier row: only the super admin may delete one.
create or replace function prevent_admin_account_deletion()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if old.admin_tier = 'super_admin' then
    raise exception 'The super admin account cannot be deleted.';
  end if;
  if old.admin_tier is not null and not is_super_admin() then
    raise exception 'Only the super admin can delete an admin-tier account.';
  end if;
  return old;
end;
$$;

create trigger profiles_prevent_admin_deletion
  before delete on profiles
  for each row execute function prevent_admin_account_deletion();
