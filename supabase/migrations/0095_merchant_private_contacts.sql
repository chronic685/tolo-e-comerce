-- Close the public exposure of merchants' contact details.
--
-- Until now anyone, signed in or not, could read an active merchant's whole row
-- (policy merchants_public_select_active, 0019): phone, email, the owner's name, phone
-- and email, the business registration number. This was confirmed against the live
-- project with the public anon key.
--
-- WHY A SEPARATE TABLE. The storefront reads merchants through embeds
-- (merchants!inner ( status, is_test, ... )) and through whole-row computed columns
-- (merchants_avg_rating and friends). Postgres column privileges cannot hide one column
-- from a role that also needs whole-row reads, and they cannot be row-aware (an owner
-- must read their own phone while a customer must not). So the private columns move to
-- merchant_private, where row-level security can say who may read them, and merchants
-- keeps only what is safe to show: name, category, status, address area, coordinates.
--
-- WHAT MOVES: phone, email, owner_full_name, owner_phone, owner_email,
-- business_registration_number. Nothing else changes on merchants, and no storefront
-- query reads these columns, so the customer site and the Tolo-embedded marketplace are
-- untouched.

create table merchant_private (
  merchant_id uuid primary key references merchants(id) on delete cascade,
  phone text,
  email text,
  owner_full_name text,
  owner_phone text,
  owner_email text,
  business_registration_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into merchant_private (merchant_id, phone, email, owner_full_name, owner_phone, owner_email, business_registration_number)
select id, phone, email, owner_full_name, owner_phone, owner_email, business_registration_number
from merchants;

alter table merchants
  drop column phone,
  drop column email,
  drop column owner_full_name,
  drop column owner_phone,
  drop column owner_email,
  drop column business_registration_number;

create trigger merchant_private_set_updated_at
  before update on merchant_private
  for each row execute function set_updated_at();

alter table merchant_private enable row level security;

-- Read: the merchant's own owner and staff, and Tolo staff whose pages need to reach the merchant.
-- Not customers, not anonymous visitors.
create policy merchant_private_select on merchant_private
  for select using (
    is_merchant_member(merchant_id)
    or exists (select 1 from merchants m where m.id = merchant_private.merchant_id and m.owner_id = auth.uid())
    or has_admin_page(array['merchants', 'orders', 'support', 'delivery_ops'])
  );

-- Write: the owner (the dashboard sign-up form fills it in) and Merchants-page staff. Which columns staff may
-- change is limited by the trigger below.
create policy merchant_private_insert on merchant_private
  for insert with check (
    exists (select 1 from merchants m where m.id = merchant_private.merchant_id and m.owner_id = auth.uid())
    or has_admin_page(array['merchants'])
  );

create policy merchant_private_update on merchant_private
  for update using (
    exists (select 1 from merchants m where m.id = merchant_private.merchant_id and m.owner_id = auth.uid())
    or has_admin_page(array['merchants'])
  );

revoke all on merchant_private from anon;
revoke delete, truncate on merchant_private from authenticated;

-- Staff with the Merchants page may fix contact details, but phone numbers and the registration
-- number are admin-tier only. The merchant's own owner and the service role are not limited.
create or replace function trg_guard_merchant_private()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null or is_tolo_admin() then
    return new;
  end if;
  if exists (select 1 from merchants m where m.id = new.merchant_id and m.owner_id = auth.uid()) then
    return new;
  end if;
  if tg_op = 'UPDATE' and (
       new.phone is distinct from old.phone
    or new.owner_phone is distinct from old.owner_phone
    or new.business_registration_number is distinct from old.business_registration_number
  ) then
    raise exception 'Only an admin or super admin can change a merchant''s phone numbers or registration number.';
  end if;
  return new;
end;
$$;

revoke execute on function trg_guard_merchant_private() from public, anon, authenticated;

create trigger merchant_private_guard
  before insert or update on merchant_private
  for each row execute function trg_guard_merchant_private();

-- Same function as 0094; the merchant's phone now goes to merchant_private.
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
