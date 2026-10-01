-- Approving a merchant application (migration 0073) creates the real
-- merchant account. Called only by the review-merchant-application Edge
-- Function after it has (1) confirmed the caller is admin tier and
-- (2) resolved the owner account for the applicant's verified phone with
-- the same shared logic tolo-app-login uses (_shared/phone_account.ts) --
-- account creation needs the Auth Admin API, which SQL can't call.
--
-- Everything that must happen together happens here, in one transaction,
-- under a row lock: two admins approving at once can't create two
-- merchants, and an approval can never leave the application "approved"
-- without its merchant (or the reverse).
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
  v_category text;
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

  select name into v_category from categories where id = v_app.category_id;

  -- Approved straight to 'active', the same status admin-dashboard's
  -- Merchants page sets when it approves a merchant.
  insert into merchants (owner_id, business_name, business_category, phone, location, status, approved_at, approved_by)
  values (p_owner_id, v_app.business_name, v_category, v_app.applicant_phone, v_app.address, 'active', now(), p_reviewer_id)
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
-- The owner id is trusted as-is here, so only the service role (i.e. the
-- Edge Function, after its own checks) may call this.
revoke execute on function approve_merchant_application(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function approve_merchant_application(uuid, uuid, uuid, text) to service_role;

-- Bridge signal for the Tolo app (docs/integration/tolo-app.md): "should
-- this phone see a Merchant button, and where is its application?" --
-- answered for a phone the Tolo backend vouches for, via the
-- merchant-application-status Edge Function.
--
-- is_merchant looks at merchant accounts, not just applications: any
-- active merchant owned by the account linked to this phone
-- (tolo_phone_links, migration 0072) counts, however it was created.
-- Suspended/closed merchants don't. Never matched on profiles.phone.
create or replace function merchant_status_for_phone(p_phone text)
returns table (
  application_id uuid,
  application_status merchant_application_status,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  admin_note text,
  is_merchant boolean,
  merchant_id uuid
)
language sql stable security definer set search_path = public
as $$
  with latest as (
    select a.* from merchant_applications a
    where a.applicant_phone = p_phone
    order by a.created_at desc
    limit 1
  ),
  merchant as (
    select m.id from merchants m
    join tolo_phone_links l on l.user_id = m.owner_id
    where l.phone = p_phone
      and m.status = 'active'
    order by m.created_at
    limit 1
  )
  select l.id, l.status, l.created_at, l.reviewed_at, l.admin_note,
         exists (select 1 from merchant), (select id from merchant)
  from (select 1) one
  left join latest l on true;
$$;
revoke execute on function merchant_status_for_phone(text) from public, anon, authenticated;
grant execute on function merchant_status_for_phone(text) to service_role;
