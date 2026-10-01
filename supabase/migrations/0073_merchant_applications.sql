-- "Apply to become a merchant" from inside the Tolo customer app
-- (docs/integration/tolo-app.md). The applicant is already signed in
-- through the tolo-app-login handoff, so their phone is never collected or
-- re-verified here -- it is read from the session's own phone link.
--
-- Separate from the merchants table on purpose: an application is a
-- review record (who asked, what they sent, who decided, why), and only an
-- approval turns it into a real merchants row (migration 0075). Keeping
-- pending/rejected requests out of merchants means nothing that lists or
-- counts merchants has to learn to skip them.

-- 1. The session's verified phone ----------------------------------------
-- The Tolo-verified phone linked to this session's account
-- (tolo_phone_links, migration 0072) -- the same record tolo-app-login
-- matches sign-ins on, and one no user can write. Never profiles.phone /
-- profiles.phone_verified, which every account can edit on its own row.
-- Null if the account isn't linked to a Tolo phone.
--
-- Only submit_merchant_application() calls this (as its definer), so no
-- client role may execute it. RLS policies that need the same value read
-- tolo_phone_links inline instead (its own-row select policy already
-- exposes exactly this): a policy calling a function anon can't execute
-- would turn an anonymous read into a permission error, not an empty
-- result.
create or replace function session_verified_phone()
returns text
language sql stable security definer set search_path = public
as $$
  select phone from tolo_phone_links where user_id = auth.uid();
$$;
revoke execute on function session_verified_phone() from public, anon, authenticated;

-- 2. Table ----------------------------------------------------------------
create type merchant_application_status as enum ('pending', 'approved', 'rejected');

create table merchant_applications (
  id uuid primary key default gen_random_uuid(),
  -- The account that applied. Kept alongside the phone so approval can
  -- attach the merchant to that exact account (migration 0075).
  applicant_id uuid not null references profiles(id) on delete cascade,
  applicant_phone text not null check (applicant_phone ~ '^\+251[79][0-9]{8}$'),
  business_name text not null check (char_length(btrim(business_name)) between 2 and 120),
  category_id uuid not null references categories(id) on delete restrict,
  address text not null check (char_length(btrim(address)) between 5 and 300),
  -- Storage path in the private merchant-application-licenses bucket
  -- (migration 0074), not a public URL -- same convention as
  -- merchant_documents.file_url. Admins open it through a signed URL.
  license_photo_url text not null,
  status merchant_application_status not null default 'pending',
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  admin_note text check (admin_note is null or char_length(admin_note) <= 1000),
  -- Set on approval: the merchants row this application became.
  merchant_id uuid references merchants(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint merchant_applications_approved_has_merchant check (status <> 'approved' or merchant_id is not null)
);

-- "Can't apply twice while pending" is a real constraint, not only a check
-- in the submit function, so two simultaneous submits can't both land.
-- Rejected rows don't count -- a rejected applicant may reapply.
create unique index idx_merchant_applications_one_pending
  on merchant_applications(applicant_phone) where status = 'pending';
create index idx_merchant_applications_status on merchant_applications(status, created_at desc);
create index idx_merchant_applications_phone on merchant_applications(applicant_phone, created_at desc);

create trigger merchant_applications_set_updated_at
  before update on merchant_applications
  for each row execute function set_updated_at();

-- 3. Review guard ----------------------------------------------------------
-- RLS is per row, not per column, so the "only a review may change this,
-- and only once" rules live in a trigger -- same reasoning as
-- prevent_role_self_escalation (migrations 0013/0049).
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

create trigger merchant_applications_guard_review
  before update on merchant_applications
  for each row execute function guard_merchant_application_review();

-- Postgres doesn't check EXECUTE when firing a trigger, only when someone
-- calls the function directly -- so the default grants can go without
-- affecting the guard (supabase/tests/merchant_applications.test.ts runs
-- every review path as authenticated with this revoked).
revoke execute on function guard_merchant_application_review() from public, anon, authenticated;

-- 4. RLS -------------------------------------------------------------------
-- Admin tier only (is_tolo_admin(): admin or super_admin, migration 0050)
-- -- deliberately NOT has_admin_page(array['merchants']): approving an
-- application creates a merchant account outright, so page-permission
-- staff can't review these.
alter table merchant_applications enable row level security;

create policy merchant_applications_select on merchant_applications
  for select using (
    applicant_phone = (select l.phone from tolo_phone_links l where l.user_id = auth.uid())
    or is_tolo_admin()
  );

-- Reject / add a note. Approval also passes this check but is then refused
-- by the guard trigger above unless it comes from approve_merchant_application().
create policy merchant_applications_review on merchant_applications
  for update using (is_tolo_admin()) with check (is_tolo_admin());

-- No insert policy: applicants submit through submit_merchant_application()
-- below, which derives the phone itself. No delete policy: applications
-- are kept as the review record.

-- 5. Submit ----------------------------------------------------------------
-- Errors are raised with a stable machine-readable message (the frontend
-- maps each to its own copy) and SQLSTATE P0001.
create or replace function submit_merchant_application(
  p_business_name text,
  p_category_id uuid,
  p_address text,
  p_license_photo_url text
)
returns merchant_applications
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_phone text := session_verified_phone();
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

  -- The photo must be one this same account uploaded into its own folder
  -- of the licenses bucket (storage policy, migration 0074) -- an
  -- applicant can't point their application at someone else's upload.
  if p_license_photo_url is null
    or split_part(p_license_photo_url, '/', 1) <> v_uid::text
    or not exists (
      select 1 from storage.objects
      where bucket_id = 'merchant-application-licenses' and name = p_license_photo_url
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
    insert into merchant_applications (applicant_id, applicant_phone, business_name, category_id, address, license_photo_url)
    values (v_uid, v_phone, btrim(p_business_name), p_category_id, btrim(p_address), p_license_photo_url)
    returning * into v_row;
  exception
    -- Lost a race with a concurrent submit for the same phone.
    when unique_violation then
      raise exception 'application_pending';
    when check_violation then
      raise exception 'invalid_details';
  end;

  return v_row;
end;
$$;
revoke execute on function submit_merchant_application(text, uuid, text, text) from public, anon;
grant execute on function submit_merchant_application(text, uuid, text, text) to authenticated;
