-- A merchant's category is a link to the admin-managed categories table, not
-- text copied into business_category. business_category (and business_subcategory)
-- stay as a read-only legacy value for merchants created before this; nothing
-- writes them any more.
alter table merchants add column category_id uuid references categories(id) on delete set null;
create index idx_merchants_category on merchants(category_id);

-- Backfill: where the old free-text value is exactly (ignoring case and
-- surrounding spaces) the name of an existing category, link it. Everything else
-- (typos like "cosmotics", subcategory-style entries) is left null for an admin
-- to confirm on the Merchants page; nothing is guessed.
update merchants m
set category_id = c.id
from categories c
where m.category_id is null
  and m.business_category is not null
  and lower(btrim(m.business_category)) = lower(btrim(c.name));

-- Same function as 0075, but the approved merchant gets the application's
-- category_id instead of a copy of the category's name.
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
  insert into merchants (owner_id, business_name, category_id, phone, location, status, approved_at, approved_by)
  values (p_owner_id, v_app.business_name, v_app.category_id, v_app.applicant_phone, v_app.address, 'active', now(), p_reviewer_id)
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
