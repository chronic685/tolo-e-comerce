-- One Merchants page in the admin dashboard, for both ways a merchant gets onboarded.
--
-- 1. merchants.source says which path created the row: 'dashboard' (the person
--    signed up in the merchant dashboard and uploaded documents) or 'tolo_app' (an
--    application from the Tolo app, approved by an admin). It is a column, not a
--    join to merchant_applications, because only admin-tier staff can read
--    applications and the Merchants page is open to staff with the Merchants page.
alter table merchants
  add column source text not null default 'dashboard' check (source in ('dashboard', 'tolo_app'));

update merchants m
set source = 'tolo_app'
from merchant_applications a
where a.merchant_id = m.id;

-- Same function as 0090, plus source = 'tolo_app' on the merchant it creates.
create or replace function approve_merchant_application(
  p_application_id uuid,
  p_owner_id uuid,
  p_reviewer_id uuid,
  p_note text
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_app merchant_applications;
  v_merchant_id uuid;
begin
  -- Defense in depth: the Edge Function already checked this.
  if not exists (
    select 1 from profiles
    where id = p_reviewer_id and account_status = 'active' and admin_tier is not null
  ) then
    raise exception 'not_admin';
  end if;

  select * into v_app from merchant_applications where id = p_application_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_app.status <> 'pending' then
    raise exception 'already_reviewed';
  end if;

  if exists (select 1 from merchants where owner_id = p_owner_id) then
    raise exception 'already_merchant';
  end if;

  -- Approved straight to 'active', the same status admin-dashboard's
  -- Merchants page sets when it approves a merchant.
  insert into merchants (owner_id, business_name, category_id, source, phone, location, status, approved_at, approved_by)
  values (p_owner_id, v_app.business_name, v_app.category_id, 'tolo_app', v_app.applicant_phone, v_app.address, 'active', now(), p_reviewer_id)
  returning id into v_merchant_id;

  -- Lets guard_merchant_application_review() (migration 0073) accept this
  -- one status flip; transaction-local, so it never leaks to other rows or
  -- later statements.
  perform set_config('tolo.approving_merchant_application', p_application_id::text, true);

  update merchant_applications
  set status = 'approved',
      merchant_id = v_merchant_id,
      reviewed_by = p_reviewer_id,
      admin_note = nullif(btrim(coalesce(p_note, '')), '')
  where id = p_application_id;

  perform set_config('tolo.approving_merchant_application', '', true);

  return v_merchant_id;
end;
$$;

-- 2. Approving or rejecting a merchant is admin-tier only, in the database.
--
-- Until now merchants_update let anyone with the Merchants page (and the merchant's
-- own owner!) write any column, status included, so "only admin and super admin can
-- approve" was a button hidden in the UI. This trigger makes it real:
--   * leaving registered / pending_verification / under_review (an approval or a
--     rejection) needs admin or super admin;
--   * after that, staff with the Merchants page may still suspend and reinstate;
--   * a merchant (or anyone else) cannot change status, the approval fields, the
--     reasons or the source of their own row.
-- The service role (auth.uid() is null: Edge Functions, migrations, tests) is trusted.
create or replace function trg_guard_merchant_review()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_staff boolean;
begin
  if auth.uid() is null or is_tolo_admin() then
    return new;
  end if;

  v_staff := has_admin_page(array['merchants']);

  if new.status is distinct from old.status then
    if old.status in ('registered', 'pending_verification', 'under_review') then
      raise exception 'Only an admin or super admin can approve or reject a merchant.';
    end if;
    if not v_staff then
      raise exception 'Only Tolo staff can change a merchant''s status.';
    end if;
  end if;

  if not v_staff and (
       new.approved_at is distinct from old.approved_at
    or new.approved_by is distinct from old.approved_by
    or new.source is distinct from old.source
    or (to_jsonb(new) ->> 'rejection_reason') is distinct from (to_jsonb(old) ->> 'rejection_reason')
    or (to_jsonb(new) ->> 'suspension_reason') is distinct from (to_jsonb(old) ->> 'suspension_reason')
  ) then
    raise exception 'These fields are set by Tolo staff.';
  end if;

  -- Staff may suspend and reinstate, but not stamp an approval.
  if v_staff and (new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by) then
    raise exception 'Only an admin or super admin can approve or reject a merchant.';
  end if;

  return new;
end;
$$;

revoke execute on function trg_guard_merchant_review() from public, anon, authenticated;

create trigger merchants_guard_review
  before update on merchants
  for each row execute function trg_guard_merchant_review();

-- 3. The old "Merchant Applications" page permission folds into "Merchants".
-- That page was admin-tier only and never grantable to staff, so this normally
-- touches nobody; it is here so a key that did end up in a permissions list keeps
-- meaning something and does not linger.
update profiles
set permissions = (permissions || '["merchants"]'::jsonb) - 'merchant_applications'
where permissions ? 'merchant_applications' and not (permissions ? 'merchants');

update profiles
set permissions = permissions - 'merchant_applications'
where permissions ? 'merchant_applications';
