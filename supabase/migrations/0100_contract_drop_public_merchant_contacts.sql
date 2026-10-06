-- CONTRACT phase of the "private merchant contacts" rollout.
--
--   >>> APPLY ONLY AFTER ALL CODE AND EDGE FUNCTIONS ARE DEPLOYED. <<<
--
-- Before applying, check, in this order:
--   1. 0099_expand_merchant_private_and_admin_controls.sql is applied.
--   2. These are deployed from code that reads merchant_private (with the fallback to the old columns, which this file removes the need for):
--        Edge Functions: order-status, delivery-handoff
--        Dashboards:     merchant-dashboard, admin-dashboard
--      An old copy of any of them still running after this file is applied will fail on the dropped columns
--      (the merchant sign-up form, the pickup phone on ready orders, the admin Merchants list).
--   3. Nothing else selects merchants.{phone, email, owner_full_name, owner_phone, owner_email, business_registration_number}
--      (grep the repo and the Edge Functions; the QA fixtures and tests already write merchant_private).
--
-- What it does: stops copying between the two tables, drops the six private columns from the publicly readable merchants row (which closes the
-- exposure: anonymous visitors and signed-in customers can read none of them any more), and replaces approve_merchant_application() so an approved
-- merchant's phone goes to merchant_private directly. merchant_private is then the only home of those fields.
--
-- Rolling back means re-adding the columns and re-copying from merchant_private; take a backup first (docs/development-guidelines.md, rule 13).

drop trigger if exists merchants_sync_to_private on merchants;
drop trigger if exists merchant_private_sync_to_merchants on merchant_private;
drop function if exists trg_merchants_to_private();
drop function if exists trg_private_to_merchants();

-- A last copy, in case anything wrote the old columns after the previous sync and before the drop.
insert into merchant_private (merchant_id, phone, email, owner_full_name, owner_phone, owner_email, business_registration_number)
select id, phone, email, owner_full_name, owner_phone, owner_email, business_registration_number from merchants
on conflict (merchant_id) do update set
  phone = coalesce(merchant_private.phone, excluded.phone), email = coalesce(merchant_private.email, excluded.email), owner_full_name = coalesce(merchant_private.owner_full_name, excluded.owner_full_name), owner_phone = coalesce(merchant_private.owner_phone, excluded.owner_phone), owner_email = coalesce(merchant_private.owner_email, excluded.owner_email), business_registration_number = coalesce(merchant_private.business_registration_number, excluded.business_registration_number);

alter table merchants
  drop column phone,
  drop column email,
  drop column owner_full_name,
  drop column owner_phone,
  drop column owner_email,
  drop column business_registration_number;

-- Fail loudly rather than leave a half-closed exposure.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'merchants'
      and column_name in ('phone', 'email', 'owner_full_name', 'owner_phone', 'owner_email', 'business_registration_number')
  ) then
    raise exception 'merchants still has a private contact column';
  end if;
end;
$$;

-- Same function as 0094, but the merchant's phone now goes straight to merchant_private (no merchants.phone to sync from).
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

  perform set_config('tolo.approving_merchant_application', p_application_id::text, true);

  -- Approved straight to 'active', the same status admin-dashboard's
  -- Merchants page sets when it approves a merchant.
  insert into merchants (owner_id, business_name, category_id, source, location, status, approved_at, approved_by)
  values (p_owner_id, v_app.business_name, v_app.category_id, 'tolo_app', v_app.address, 'active', now(), p_reviewer_id)
  returning id into v_merchant_id;

  -- The applicant's verified phone is the merchant's contact number (private, see merchant_private).
  insert into merchant_private (merchant_id, phone) values (v_merchant_id, v_app.applicant_phone);

  -- The applicant's TIN moves with the application: it becomes the merchant's.
  if v_app.tin is not null then
    insert into merchant_tins (merchant_id, tin) values (v_merchant_id, v_app.tin);
  end if;

  -- Lets guard_merchant_application_review() (migration 0073) accept this
  -- one status flip; transaction-local, so it never leaks to other rows or
  -- later statements.

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
