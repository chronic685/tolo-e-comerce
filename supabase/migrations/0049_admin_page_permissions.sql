-- Per-staff page-level access control for admin-dashboard. Checked first,
-- per the task's own instruction: no admin-users table exists separately
-- from profiles (Users.tsx already lists/edits staff as
-- `profiles where role <> 'customer'`, promoting an existing registered
-- account by changing its role -- there is no separate staff-creation
-- flow), and no permissions/super-admin concept existed anywhere yet.
--
-- No new is_super_admin column: role = 'tolo_admin' already is this
-- platform's one top privilege tier -- is_tolo_admin() (migration 0013)
-- already gates every other sensitive write, and
-- prevent_role_self_escalation (also 0013) already restricts changing
-- ANYONE's role, including your own, to exactly that role. Adding a
-- second, separate "super admin" flag would just be a duplicate of this
-- one with its own bootstrapping question ("what happens if tolo_admin and
-- is_super_admin disagree?") for no real benefit. "Super admin" means
-- is_tolo_admin() throughout this feature.
alter table profiles add column permissions jsonb not null default '[]'::jsonb;

-- Existing staff keep exactly the full access they already had before this
-- feature existed -- only staff promoted AFTER this migration start with
-- zero pages and need an explicit grant. Without this backfill, every
-- non-tolo_admin staff account would be locked out of the entire admin
-- panel the instant this ships (tolo_admin accounts are unaffected either
-- way -- super admins bypass the permissions list entirely, see
-- admin-dashboard/src/lib/AuthContext.tsx's hasAccess()). This list is a
-- one-time snapshot of admin-dashboard/src/lib/adminPages.ts's keys at the
-- time this migration was written -- not something this migration keeps in
-- sync with future page additions, same as every other one-off data
-- backfill in this codebase.
update profiles
set permissions = '["dashboard","orders","payments","merchants","products","customers","delivery_ops","pricing_rules","refunds","settlements","inventory_movements","notification_templates","support","users","audit_log","settings"]'::jsonb
where role <> 'customer';

-- Extends the existing role-escalation guard rather than adding a second
-- trigger -- same enforcement problem (a regular staff member, even one
-- granted "users" page access, must never be able to widen anyone's
-- access, including their own), same fix. RLS can't express "only some
-- columns of this row are writable by this role" (it's a per-row, not
-- per-column, mechanism) -- a trigger is what the existing role column
-- already uses for exactly this reason, and permissions needs the same
-- column-level restriction.
create or replace function prevent_role_self_escalation()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.role <> old.role and not is_tolo_admin() then
    raise exception 'Only tolo_admin can change platform roles';
  end if;
  if new.permissions <> old.permissions and not is_tolo_admin() then
    raise exception 'Only tolo_admin can change page permissions';
  end if;
  return new;
end;
$$;
