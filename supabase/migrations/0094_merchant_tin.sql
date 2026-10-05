-- Taxpayer Identification Number (TIN): a required 10-digit field on a merchant
-- application, replacing the license photo (the upload stays in the code behind a
-- constant, off; the license columns and bucket are untouched).
--
-- WHERE THE TIN LIVES. On merchant_applications as a plain column: only the applicant
-- (their own phone) and admin-tier staff can read that table. For merchants it lives in
-- merchant_tins, a 1:1 table with its own row-level security, NOT as a merchants column:
-- merchants rows are publicly readable for active merchants (policy
-- merchants_public_select_active, 0019: phone, email and owner name are visible to
-- anon today), and Postgres column privileges cannot hide one column there without
-- breaking whole-row reads such as the merchants_avg_rating() computed columns the
-- storefront uses. A tax ID must not be public.
--
-- Provided by the applicant and not verified by the system: the admin UI says so.

-- 1. Applications ---------------------------------------------------------------
alter table merchant_applications add column tin text check (tin is null or tin ~ '^[0-9]{10}$');
alter table merchant_applications alter column license_photo_url drop not null;

-- One TIN across every pending and approved application. (A rejected application frees it.)
create unique index idx_merchant_applications_tin_active
  on merchant_applications(tin) where tin is not null and status in ('pending', 'approved');

-- Same guard as 0073: submitted details can't change after the fact, now including the TIN.
create or replace function guard_merchant_application_review()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.applicant_id is distinct from old.applicant_id
    or new.applicant_phone is distinct from old.applicant_phone
    or new.business_name is distinct from old.business_name
    or new.category_id is distinct from old.category_id
    or new.address is distinct from old.address
    or new.license_photo_url is distinct from old.license_photo_url
    or new.tin is distinct from old.tin
    or new.created_at is distinct from old.created_at then
    raise exception 'An application''s submitted details can''t be changed.';
  end if;

  if new.status is distinct from old.status then
    if old.status <> 'pending' then
      raise exception 'This application has already been reviewed.';
    end if;
    -- Approval must go through approve_merchant_application() (migration
    -- 0074), which creates the merchant in the same transaction; a direct
    -- status flip would leave an "approved" applicant with no merchant
    -- account.
    if new.status = 'approved'
      and coalesce(current_setting('tolo.approving_merchant_application', true), '') <> new.id::text then
      raise exception 'Approve applications through approve_merchant_application().';
    end if;
    new.reviewed_at := now();
    if auth.uid() is not null then
      new.reviewed_by := auth.uid();
    end if;
  elsif new.reviewed_by is distinct from old.reviewed_by or new.reviewed_at is distinct from old.reviewed_at then
    raise exception 'reviewed_by/reviewed_at are recorded by the review itself.';
  end if;

  if new.merchant_id is distinct from old.merchant_id
    and coalesce(current_setting('tolo.approving_merchant_application', true), '') <> new.id::text then
    raise exception 'merchant_id is set only by approve_merchant_application().';
  end if;

  return new;
end;
$$;

-- 2. Merchants ------------------------------------------------------------------
create table merchant_tins (
  merchant_id uuid primary key references merchants(id) on delete cascade,
  tin text not null check (tin ~ '^[0-9]{10}$'),
  updated_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index idx_merchant_tins_tin on merchant_tins(tin);

create trigger merchant_tins_set_updated_at
  before update on merchant_tins
  for each row execute function set_updated_at();

alter table merchant_tins enable row level security;

-- Read: admin tier, and the merchant's own owner. Staff with only the Merchants page
-- do not see tax IDs. Nobody writes directly: the grants are revoked and the
-- policies below stop at select; set_merchant_tin() and the approval function (both
-- security definer) are the only writers.
create policy merchant_tins_select on merchant_tins
  for select using (
    is_tolo_admin()
    or exists (select 1 from merchants m where m.id = merchant_tins.merchant_id and m.owner_id = auth.uid())
  );

revoke insert, update, delete, truncate on merchant_tins from anon, authenticated;
revoke all on merchant_tins from anon;

-- 3. One TIN across applications and merchants -------------------------------------
-- The unique indexes cover each table; these triggers cover the gap between them: a TIN
-- on a pending or approved application cannot also be a merchant's, and the reverse.
-- Approving an application is exempt for that one application (it carries its own TIN
-- over), via the same transaction-local flag the approval already uses.
create or replace function trg_application_tin_not_taken()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.tin is not null and new.status in ('pending', 'approved')
     and exists (select 1 from merchant_tins t where t.tin = new.tin and t.merchant_id is distinct from new.merchant_id) then
    raise exception 'tin_already_registered';
  end if;
  return new;
end;
$$;

create or replace function trg_merchant_tin_not_taken()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if exists (
    select 1 from merchant_applications a
    where a.tin = new.tin
      and a.status in ('pending', 'approved')
      and a.merchant_id is distinct from new.merchant_id
      and a.id::text <> coalesce(current_setting('tolo.approving_merchant_application', true), '')
  ) then
    raise exception 'tin_already_registered';
  end if;
  return new;
end;
$$;

revoke execute on function trg_application_tin_not_taken() from public, anon, authenticated;
revoke execute on function trg_merchant_tin_not_taken() from public, anon, authenticated;

create trigger merchant_applications_tin_not_taken
  before insert or update of tin, status on merchant_applications
  for each row execute function trg_application_tin_not_taken();

create trigger merchant_tins_not_taken
  before insert or update of tin on merchant_tins
  for each row execute function trg_merchant_tin_not_taken();

-- 4. Setting a merchant's TIN ---------------------------------------------------------
-- Admin tier may set, change or clear (null) any merchant's TIN. A merchant's own owner
-- may set it once, while none is on file (the dashboard sign-up form); after that only an
-- admin can change it. A person's change is audited with only the last four digits.
create or replace function set_merchant_tin(p_merchant_id uuid, p_tin text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_admin boolean := is_tolo_admin();
  v_owner boolean;
  v_existing text;
begin
  select exists (select 1 from merchants where id = p_merchant_id and owner_id = auth.uid()) into v_owner;
  select tin into v_existing from merchant_tins where merchant_id = p_merchant_id;

  if auth.uid() is not null and not v_admin and not (v_owner and v_existing is null) then
    raise exception 'Only an admin or super admin can change a merchant''s TIN.';
  end if;
  if not exists (select 1 from merchants where id = p_merchant_id) then
    raise exception 'merchant_not_found';
  end if;

  if p_tin is null or btrim(p_tin) = '' then
    if not v_admin and auth.uid() is not null then
      raise exception 'invalid_tin';
    end if;
    delete from merchant_tins where merchant_id = p_merchant_id;
  else
    if btrim(p_tin) !~ '^[0-9]{10}$' then
      raise exception 'invalid_tin';
    end if;
    begin
      insert into merchant_tins (merchant_id, tin, updated_by)
      values (p_merchant_id, btrim(p_tin), auth.uid())
      on conflict (merchant_id) do update set tin = excluded.tin, updated_by = excluded.updated_by;
    exception when unique_violation then
      raise exception 'tin_already_registered';
    end;
  end if;

  if auth.uid() is not null then
    insert into audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'update', 'merchant_tins', p_merchant_id,
            jsonb_build_object('before_last4', right(v_existing, 4), 'after_last4', right(btrim(p_tin), 4)));
  end if;
end;
$$;

revoke execute on function set_merchant_tin(uuid, text) from public, anon;
grant execute on function set_merchant_tin(uuid, text) to authenticated, service_role;

-- 5. Submitting an application ----------------------------------------------------------
-- Same function as 0073 with the TIN required and the license photo optional (null while the
-- upload is switched off in the app). Errors keep the stable machine-readable messages.
drop function if exists submit_merchant_application(text, uuid, text, text);

create or replace function submit_merchant_application(
  p_business_name text,
  p_category_id uuid,
  p_address text,
  p_tin text,
  p_license_photo_url text default null
)
returns merchant_applications
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_phone text := session_verified_phone();
  v_tin text := btrim(p_tin);
  v_row merchant_applications;
begin
  if v_uid is null or v_phone is null then
    raise exception 'phone_not_verified';
  end if;

  if not exists (select 1 from profiles where id = v_uid and account_status = 'active') then
    raise exception 'account_inactive';
  end if;

  if not exists (select 1 from categories where id = p_category_id and is_active) then
    raise exception 'invalid_category';
  end if;

  if v_tin is null or v_tin !~ '^[0-9]{10}$' then
    raise exception 'invalid_tin';
  end if;

  -- Optional: only checked when a photo is sent. It must be one this same account uploaded into
  -- its own folder of the licenses bucket (storage policy, migration 0074).
  if p_license_photo_url is not null
    and (
      split_part(p_license_photo_url, '/', 1) <> v_uid::text
      or not exists (
        select 1 from storage.objects
        where bucket_id = 'merchant-application-licenses' and name = p_license_photo_url
      )
    ) then
    raise exception 'invalid_license_photo';
  end if;

  if exists (select 1 from merchant_applications where applicant_phone = v_phone and status = 'approved') then
    raise exception 'already_merchant';
  end if;

  if exists (select 1 from merchant_applications where applicant_phone = v_phone and status = 'pending') then
    raise exception 'application_pending';
  end if;

  begin
    insert into merchant_applications (applicant_id, applicant_phone, business_name, category_id, address, tin, license_photo_url)
    values (v_uid, v_phone, btrim(p_business_name), p_category_id, btrim(p_address), v_tin, p_license_photo_url)
    returning * into v_row;
  exception
    -- Lost a race with a concurrent submit for the same phone, or the TIN is already on a
    -- pending/approved application (the unique index) -- tell them apart by the constraint.
    when unique_violation then
      if exists (select 1 from merchant_applications where tin = v_tin and status in ('pending', 'approved')) then
        raise exception 'tin_already_registered';
      end if;
      raise exception 'application_pending';
    when check_violation then
      raise exception 'invalid_details';
  end;

  return v_row;
end;
$$;

revoke execute on function submit_merchant_application(text, uuid, text, text, text) from public, anon;
grant execute on function submit_merchant_application(text, uuid, text, text, text) to authenticated;

-- 6. Approval carries the TIN to the merchant ------------------------------------------------
-- Same function as 0093; the approval flag is set before the merchant is created (so the TIN
-- cross-check lets this one application through) and the application's TIN becomes the
-- merchant's.
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
  insert into merchants (owner_id, business_name, category_id, source, phone, location, status, approved_at, approved_by)
  values (p_owner_id, v_app.business_name, v_app.category_id, 'tolo_app', v_app.applicant_phone, v_app.address, 'active', now(), p_reviewer_id)
  returning id into v_merchant_id;

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
