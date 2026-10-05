-- Admin merchant detail, edit, close / reopen and delete.
--
-- WHO MAY DO WHAT (enforced here, not only in the UI):
--   view     staff with the Merchants page (admin / super admin pass every page check). TIN, payouts and
--            the applications behind a merchant are admin tier only;
--   edit     the same staff, except phone numbers, the registration number and the TIN (admin tier only, see
--            0094 and 0095). Status approve / reject stays admin tier only (0093); suspend and reinstate stay
--            open to Merchants-page staff;
--   close    admin / super admin only;
--   reopen   admin / super admin or Merchants-page staff;
--   delete   admin / super admin only, and only for a merchant that has never had an order, a payout, a
--            wallet movement or a financial adjustment.
-- Every edit, close, reopen and delete writes audit_logs (who, when, before and after; phone numbers and the
-- registration number masked to the last four characters; the TIN is audited by set_merchant_tin, 0094).
--
-- CLOSING keeps every record and is reversible:
--   * merchants.status becomes 'closed' and stores.status 'closed', with the previous values remembered so Reopen
--     puts them back;
--   * every published product is paused and flagged closed_paused, so Reopen can re-list exactly those (a product
--     that no longer passes the listing-eligibility check stays paused instead of failing the reopen);
--   * the merchant's owner and staff are locked out: is_merchant_member() now returns false for a closed
--     merchant, which every merchant-side RLS policy goes through (the owner can still read their own merchant
--     row, so the dashboard can say why);
--   * refused while the merchant has an order in progress, so nothing is stranded.
--
-- HARD DELETE cascades exactly as the foreign keys already say, written down here so nobody has to guess:
--   * stores, products, product variants, inventory, product images (rows), cart lines, favorites and reviews
--     of those products: deleted with the merchant (ON DELETE CASCADE);
--   * merchant_staff rows, merchant_documents rows, merchant_private, merchant_tins, the wallet row: deleted;
--   * merchant_applications: kept, with merchant_id set to null (ON DELETE SET NULL), so the application record
--     survives and the applicant can apply again;
--   * the owner's own profile / login: kept (it is also a customer account); it simply no longer owns a merchant;
--   * pricing and discount rules scoped to the merchant: left in place, inert (they have no foreign key);
--   * STORAGE FILES are NOT removed by the database (deleting from storage.objects in SQL leaves the file behind).
--     The function returns the file locations (product images, store logo / cover, uploaded documents) and the
--     admin dashboard deletes them through the Storage API straight after. Anything it misses is an orphan file,
--     never a dangling reference.
-- The history guard means none of the above ever touches an order, a payout or a refund.

alter table merchants
  add column closed_at timestamptz,
  add column closed_by uuid references profiles(id) on delete set null,
  add column close_reason text,
  add column status_before_close merchant_status;

alter table stores add column status_before_close store_status;
alter table products add column closed_paused boolean not null default false;

-- A closed merchant has no members: its owner and staff lose every merchant-side right in one place.
create or replace function is_merchant_member(p_merchant_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from merchants m
    where m.id = p_merchant_id
      and m.status <> 'closed'
      and (
        m.owner_id = auth.uid()
        or exists (select 1 from merchant_staff s where s.merchant_id = m.id and s.user_id = auth.uid())
      )
  );
$$;

-- 5. An application outlives the merchant it became.
-- merchant_applications.merchant_id is set null when the merchant is deleted (ON DELETE SET NULL), but an approved
-- application must name its merchant (0073). merchant_deleted_at records the deletion and relaxes that rule, frees
-- the TIN it was holding, and lets the applicant apply again.
alter table merchant_applications add column merchant_deleted_at timestamptz;

alter table merchant_applications drop constraint merchant_applications_approved_has_merchant;
alter table merchant_applications add constraint merchant_applications_approved_has_merchant
  check (status <> 'approved' or merchant_id is not null or merchant_deleted_at is not null);

drop index idx_merchant_applications_tin_active;
create unique index idx_merchant_applications_tin_active
  on merchant_applications(tin) where tin is not null and status in ('pending', 'approved') and merchant_deleted_at is null;

-- Same function as 0094, with a deleted merchant's application no longer counting as "already a merchant".
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

  if exists (select 1 from merchant_applications where applicant_phone = v_phone and status = 'approved' and merchant_deleted_at is null) then
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


-- 1. Detail --------------------------------------------------------------------------------------
create or replace function admin_merchant_detail(p_merchant_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_m merchants;
  v_admin boolean := is_tolo_admin();
begin
  if not has_admin_page(array['merchants']) then
    raise exception 'Not authorized';
  end if;

  select * into v_m from merchants where id = p_merchant_id;
  if not found then
    raise exception 'merchant_not_found';
  end if;

  return jsonb_build_object(
    'merchant', to_jsonb(v_m),
    'private', (select to_jsonb(p) - 'merchant_id' from merchant_private p where p.merchant_id = p_merchant_id),
    'store', (select to_jsonb(s) from stores s where s.merchant_id = p_merchant_id),
    'owner', (select jsonb_build_object('id', o.id, 'full_name', o.full_name) from profiles o where o.id = v_m.owner_id),
    -- TIN, payouts and applications: admin tier only.
    'tin', case when v_admin then (select t.tin from merchant_tins t where t.merchant_id = p_merchant_id) end,
    'products', jsonb_build_object(
      'total', (select count(*) from products where merchant_id = p_merchant_id),
      'published', (select count(*) from products where merchant_id = p_merchant_id and status = 'published')
    ),
    'orders', jsonb_build_object(
      'total', (select count(*) from merchant_orders where merchant_id = p_merchant_id),
      'by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from merchant_orders where merchant_id = p_merchant_id group by status) x), '{}'::jsonb)
    ),
    'rating', jsonb_build_object('avg', merchants_avg_rating(v_m), 'count', merchants_review_count(v_m)),
    'commission_rules', coalesce((select jsonb_agg(to_jsonb(c)) from commission_rules c where c.scope_type = 'merchant' and c.scope_id = p_merchant_id), '[]'::jsonb),
    'wallet_balance', case when v_admin then (select balance from merchant_wallets where merchant_id = p_merchant_id) end,
    'payouts', case when v_admin then coalesce((
      select jsonb_agg(to_jsonb(s) order by s.created_at desc) from settlements s where s.merchant_id = p_merchant_id
    ), '[]'::jsonb) else '[]'::jsonb end,
    'applications', case when v_admin then coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'status', a.status, 'created_at', a.created_at, 'reviewed_at', a.reviewed_at, 'admin_note', a.admin_note) order by a.created_at desc)
      from merchant_applications a where a.merchant_id = p_merchant_id
    ), '[]'::jsonb) else '[]'::jsonb end,
    'documents', coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at desc) from merchant_documents d where d.merchant_id = p_merchant_id), '[]'::jsonb),
    'audit', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'action', l.action, 'entity_type', l.entity_type, 'created_at', l.created_at,
                                          'actor', (select coalesce(p.full_name, p.username) from profiles p where p.id = l.actor_id),
                                          'metadata', l.metadata) order by l.created_at desc)
      from (
        select * from audit_logs
        where entity_id = p_merchant_id and entity_type in ('merchants', 'merchant_tins', 'merchant_private')
        order by created_at desc limit 50
      ) l
    ), '[]'::jsonb),
    -- Whether Delete (rather than Close) is on offer: no order, payout, wallet movement or adjustment, ever.
    'can_hard_delete', not (
      exists (select 1 from merchant_orders where merchant_id = p_merchant_id)
      or exists (select 1 from settlements where merchant_id = p_merchant_id)
      or exists (select 1 from wallet_transactions where merchant_id = p_merchant_id)
      or exists (select 1 from financial_adjustments where merchant_id = p_merchant_id)
    ),
    'active_orders', (select count(*) from merchant_orders where merchant_id = p_merchant_id
                      and status in ('new', 'accepted', 'processing', 'ready_for_pickup', 'picked_up', 'delivered'))
  );
end;
$$;

revoke execute on function admin_merchant_detail(uuid) from public, anon;
grant execute on function admin_merchant_detail(uuid) to authenticated, service_role;

-- 2. Edit ----------------------------------------------------------------------------------------
-- p_changes = { "merchant": {...}, "private": {...}, "store": {...} }, each optional.
--   merchant: business_name, category_id, location, city, sub_city, woreda, landmark, latitude, longitude
--   private:  email, owner_full_name, owner_email  |  phone, owner_phone, business_registration_number (admin tier only)
--   store:    name, description, operating_hours, logo_url, banner_url, pickup_address, prep_time_minutes, latitude, longitude
-- Status changes go through the existing status controls (guarded by 0093); the TIN through set_merchant_tin().
create or replace function admin_update_merchant(p_merchant_id uuid, p_changes jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_admin boolean := is_tolo_admin();
  v_scope text;
  v_key text;
  v_allowed text[];
  v_admin_only text[];
  v_table text;
  v_cast text;
  v_where text;
  v_old jsonb;
  v_new text;
  v_before jsonb;
  v_after jsonb;
  v_total jsonb := '{}'::jsonb;
  v_masked text[] := array['phone', 'owner_phone', 'business_registration_number'];
begin
  if auth.uid() is not null and not has_admin_page(array['merchants']) then
    raise exception 'Not authorized';
  end if;
  if not exists (select 1 from merchants where id = p_merchant_id) then
    raise exception 'merchant_not_found';
  end if;

  for v_scope in select jsonb_object_keys(p_changes) loop
    if v_scope not in ('merchant', 'private', 'store') then
      raise exception 'unsupported_field';
    end if;

    v_before := '{}'::jsonb;
    v_after := '{}'::jsonb;
    v_admin_only := array[]::text[];

    if v_scope = 'merchant' then
      v_table := 'merchants'; v_where := 'id';
      v_allowed := array['business_name', 'category_id', 'location', 'city', 'sub_city', 'woreda', 'landmark', 'latitude', 'longitude'];
      select to_jsonb(m) into v_old from merchants m where m.id = p_merchant_id;
    elsif v_scope = 'private' then
      v_table := 'merchant_private'; v_where := 'merchant_id';
      v_allowed := array['email', 'owner_full_name', 'owner_email', 'phone', 'owner_phone', 'business_registration_number'];
      v_admin_only := array['phone', 'owner_phone', 'business_registration_number'];
      insert into merchant_private (merchant_id) values (p_merchant_id) on conflict (merchant_id) do nothing;
      select to_jsonb(m) into v_old from merchant_private m where m.merchant_id = p_merchant_id;
    else
      v_table := 'stores'; v_where := 'merchant_id';
      v_allowed := array['name', 'description', 'operating_hours', 'logo_url', 'banner_url', 'pickup_address', 'prep_time_minutes', 'latitude', 'longitude'];
      select to_jsonb(s) into v_old from stores s where s.merchant_id = p_merchant_id;
      if v_old is null then
        raise exception 'merchant_has_no_store';
      end if;
    end if;

    for v_key in select jsonb_object_keys(p_changes -> v_scope) loop
      if not (v_key = any (v_allowed)) then
        raise exception 'unsupported_field';
      end if;
      if v_key = any (v_admin_only) and auth.uid() is not null and not v_admin then
        raise exception 'Only an admin or super admin can change a merchant''s phone numbers or registration number.';
      end if;

      v_new := p_changes -> v_scope ->> v_key;
      if v_key = 'operating_hours' then
        v_new := (p_changes -> v_scope -> v_key)::text;
      end if;
      if v_key in ('business_name', 'name') and (v_new is null or btrim(v_new) = '') then
        raise exception 'invalid_name';
      end if;
      v_new := nullif(btrim(v_new), '');

      v_cast := case
        when v_key = 'category_id' then 'uuid'
        when v_key in ('latitude', 'longitude') then 'numeric'
        when v_key = 'operating_hours' then 'jsonb'
        when v_key = 'prep_time_minutes' then 'integer'
        else 'text' end;

      if v_new is distinct from (v_old ->> v_key) and not (v_key = 'operating_hours' and v_new::jsonb = v_old -> v_key) then
        v_before := v_before || jsonb_build_object(v_key, case when v_key = any (v_masked) then to_jsonb(mask_last4(v_old ->> v_key)) else v_old -> v_key end);
        v_after := v_after || jsonb_build_object(v_key, case when v_key = any (v_masked) then to_jsonb(mask_last4(v_new)) else to_jsonb(v_new) end);
        execute format('update %I set %I = %s::%s where %I = $1', v_table, v_key, quote_nullable(v_new), v_cast, v_where) using p_merchant_id;
      end if;
    end loop;

    if v_after <> '{}'::jsonb then
      v_total := v_total || jsonb_build_object(v_scope, jsonb_build_object('before', v_before, 'after', v_after));
    end if;
  end loop;

  if v_total <> '{}'::jsonb then
    perform admin_audit('update', 'merchants', p_merchant_id, v_total);
  end if;
end;
$$;

revoke execute on function admin_update_merchant(uuid, jsonb) from public, anon;
grant execute on function admin_update_merchant(uuid, jsonb) to authenticated, service_role;

-- 3. Close / reopen --------------------------------------------------------------------------------
create or replace function admin_close_merchant(p_merchant_id uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_m merchants;
  v_paused int;
begin
  if auth.uid() is not null and not is_tolo_admin() then
    raise exception 'Only an admin or super admin can close a merchant.';
  end if;

  select * into v_m from merchants where id = p_merchant_id for update;
  if not found then
    raise exception 'merchant_not_found';
  end if;
  if v_m.status = 'closed' then
    raise exception 'merchant_already_closed';
  end if;
  if exists (
    select 1 from merchant_orders
    where merchant_id = p_merchant_id and status in ('new', 'accepted', 'processing', 'ready_for_pickup', 'picked_up', 'delivered')
  ) then
    raise exception 'merchant_has_active_orders';
  end if;

  update merchants
  set status_before_close = v_m.status, status = 'closed', closed_at = now(), closed_by = auth.uid(), close_reason = nullif(btrim(p_reason), '')
  where id = p_merchant_id;

  update stores set status_before_close = status, status = 'closed' where merchant_id = p_merchant_id and status <> 'closed';

  update products set status = 'paused', closed_paused = true where merchant_id = p_merchant_id and status = 'published';
  get diagnostics v_paused = row_count;

  perform admin_audit('close', 'merchants', p_merchant_id,
                      jsonb_build_object('reason', nullif(btrim(p_reason), ''), 'from_status', v_m.status, 'paused_products', v_paused, 'name', v_m.business_name));
  return jsonb_build_object('paused_products', v_paused);
end;
$$;

create or replace function admin_reopen_merchant(p_merchant_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_m merchants;
  v_row record;
  v_relisted int := 0;
  v_left_paused int := 0;
begin
  if auth.uid() is not null and not has_admin_page(array['merchants']) then
    raise exception 'Not authorized';
  end if;

  select * into v_m from merchants where id = p_merchant_id for update;
  if not found then
    raise exception 'merchant_not_found';
  end if;
  if v_m.status <> 'closed' then
    raise exception 'merchant_not_closed';
  end if;

  update merchants
  set status = coalesce(nullif(status_before_close, 'closed'), 'active'), status_before_close = null,
      closed_at = null, closed_by = null, close_reason = null
  where id = p_merchant_id;

  update stores set status = coalesce(nullif(status_before_close, 'closed'), 'active'), status_before_close = null
  where merchant_id = p_merchant_id and status = 'closed';

  -- Re-list what closing paused. One that no longer passes the listing check stays paused.
  for v_row in select id from products where merchant_id = p_merchant_id and closed_paused loop
    begin
      update products set status = 'published', closed_paused = false where id = v_row.id;
      v_relisted := v_relisted + 1;
    exception when raise_exception then
      update products set closed_paused = false where id = v_row.id;
      v_left_paused := v_left_paused + 1;
    end;
  end loop;

  perform admin_audit('reopen', 'merchants', p_merchant_id,
                      jsonb_build_object('relisted_products', v_relisted, 'left_paused', v_left_paused, 'name', v_m.business_name));
  return jsonb_build_object('relisted_products', v_relisted, 'left_paused', v_left_paused);
end;
$$;

revoke execute on function admin_close_merchant(uuid, text) from public, anon;
revoke execute on function admin_reopen_merchant(uuid) from public, anon;
grant execute on function admin_close_merchant(uuid, text) to authenticated, service_role;
grant execute on function admin_reopen_merchant(uuid) to authenticated, service_role;

-- 4. Hard delete ------------------------------------------------------------------------------------
create or replace function admin_delete_merchant(p_merchant_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_m merchants;
  v_files jsonb;
  v_application uuid;
begin
  if auth.uid() is not null and not is_tolo_admin() then
    raise exception 'Only an admin or super admin can delete a merchant.';
  end if;

  select * into v_m from merchants where id = p_merchant_id for update;
  if not found then
    raise exception 'merchant_not_found';
  end if;

  if exists (select 1 from merchant_orders where merchant_id = p_merchant_id)
     or exists (select 1 from settlements where merchant_id = p_merchant_id)
     or exists (select 1 from wallet_transactions where merchant_id = p_merchant_id)
     or exists (select 1 from financial_adjustments where merchant_id = p_merchant_id) then
    raise exception 'merchant_has_history';
  end if;

  -- Collected before the rows go, so the dashboard can remove the files from Storage afterwards.
  v_files := jsonb_build_object(
    'product_images', coalesce((select jsonb_agg(pi.url) from product_images pi join products p on p.id = pi.product_id where p.merchant_id = p_merchant_id), '[]'::jsonb),
    'store_images', coalesce((select jsonb_agg(u) from (select logo_url u from stores where merchant_id = p_merchant_id union all select banner_url from stores where merchant_id = p_merchant_id) x where u is not null), '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(file_url) from merchant_documents where merchant_id = p_merchant_id), '[]'::jsonb)
  );

  perform admin_audit('delete', 'merchants', p_merchant_id,
                      jsonb_build_object('name', v_m.business_name, 'status', v_m.status, 'owner_id', v_m.owner_id,
                                         'products', (select count(*) from products where merchant_id = p_merchant_id)));

  -- The foreign key nulls the approved application's merchant_id as the merchant goes; the application review guard
  -- (0073) only lets that column change inside an approval, so this delete says which application it is, and the
  -- application is marked as outliving its merchant first.
  update merchant_applications set merchant_deleted_at = now() where merchant_id = p_merchant_id;
  select id into v_application from merchant_applications where merchant_id = p_merchant_id and status = 'approved' limit 1;
  if v_application is not null then
    perform set_config('tolo.approving_merchant_application', v_application::text, true);
  end if;

  delete from merchants where id = p_merchant_id;

  perform set_config('tolo.approving_merchant_application', '', true);
  return v_files;
end;
$$;

revoke execute on function admin_delete_merchant(uuid) from public, anon;
grant execute on function admin_delete_merchant(uuid) to authenticated, service_role;
