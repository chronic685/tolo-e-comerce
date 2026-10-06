-- EXPAND phase of the "private merchant contacts" rollout, plus the admin customer and merchant controls.
--
-- THE PROBLEM. Anyone, signed in or not, can read an active merchant's whole row (policy merchants_public_select_active, 0019):
-- phone, email, the owner's name, phone and email, the business registration number. Confirmed against the live project with the
-- public anon key.
--
-- WHY TWO PHASES. Dropping those columns in one step breaks whatever code is still running against them (the deployed
-- order-status and delivery-handoff functions read merchants.phone, the merchant sign-up form writes it). So the fix ships as:
--
--   1. THIS FILE (expand). Purely additive: nothing is dropped, revoked or renamed. It creates merchant_private, backfills it, and keeps the
--      two copies in step with a trigger in each direction, so OLD code (reads and writes merchants.phone ...) and NEW code (reads and
--      writes merchant_private) both work, before or after this migration is applied, and in any deploy order. It also adds the
--      admin customer / merchant functions and a view of the safe public columns.
--      The public exposure is NOT closed by this file. That is deliberate: it cannot be closed without breaking old code.
--   2. 0100_contract_drop_public_merchant_contacts.sql (contract), applied only once every Edge Function and dashboard that
--      reads the old columns has been deployed. It stops the sync, drops the old columns from merchants and closes the exposure.
--
-- WHY A SEPARATE TABLE AT ALL. The storefront reads merchants through embeds (merchants!inner ( status, is_test, ... )) and through whole-row
-- computed columns (merchants_avg_rating and friends). Postgres column privileges cannot hide one column from a role that also needs whole-row
-- reads, and cannot be row-aware (an owner must read their own phone while a customer must not). So the private columns live in merchant_private, where
-- row-level security can say who may read them, and merchants ends up holding only what is safe to show.
--
-- WHAT IS PRIVATE: phone, email, owner_full_name, owner_phone, owner_email, business_registration_number.

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


-- Keeps the two copies identical while both exist. Each direction copies only the six private columns and only when one changed;
-- pg_trigger_depth() stops the copy from copying back. Both run as the function owner so row-level security does not get in the way, and the
-- guard triggers (staff cannot change phone numbers, merchant status rules) still see the real caller because auth.uid() is the session's.
create or replace function trg_merchants_to_private()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  insert into merchant_private (merchant_id, phone, email, owner_full_name, owner_phone, owner_email, business_registration_number)
  values (new.id, new.phone, new.email, new.owner_full_name, new.owner_phone, new.owner_email, new.business_registration_number)
  on conflict (merchant_id) do update set
    phone = excluded.phone, email = excluded.email, owner_full_name = excluded.owner_full_name, owner_phone = excluded.owner_phone, owner_email = excluded.owner_email, business_registration_number = excluded.business_registration_number
  where (merchant_private.phone, merchant_private.email, merchant_private.owner_full_name, merchant_private.owner_phone, merchant_private.owner_email, merchant_private.business_registration_number)
        is distinct from (excluded.phone, excluded.email, excluded.owner_full_name, excluded.owner_phone, excluded.owner_email, excluded.business_registration_number);
  return new;
end;
$$;

create or replace function trg_private_to_merchants()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  update merchants set
    phone = new.phone, email = new.email, owner_full_name = new.owner_full_name, owner_phone = new.owner_phone, owner_email = new.owner_email, business_registration_number = new.business_registration_number
  where id = new.merchant_id
    and (merchants.phone, merchants.email, merchants.owner_full_name, merchants.owner_phone, merchants.owner_email, merchants.business_registration_number)
        is distinct from (new.phone, new.email, new.owner_full_name, new.owner_phone, new.owner_email, new.business_registration_number);
  return new;
end;
$$;

revoke execute on function trg_merchants_to_private() from public, anon, authenticated;
revoke execute on function trg_private_to_merchants() from public, anon, authenticated;

create trigger merchants_sync_to_private
  after insert or update of phone, email, owner_full_name, owner_phone, owner_email, business_registration_number on merchants
  for each row execute function trg_merchants_to_private();

create trigger merchant_private_sync_to_merchants
  after insert or update on merchant_private
  for each row execute function trg_private_to_merchants();

-- The safe public columns of an active merchant, as a view, for code that wants a public read that cannot grow a sensitive column by accident.
-- Nothing is switched over to it yet: the storefront keeps reading merchants, which is safe once the contract migration has run.
create view merchants_public as
  select id, business_name, category_id, status, is_test, source, location, city, sub_city, woreda, landmark, latitude, longitude, created_at
  from merchants
  where status = 'active';

grant select on merchants_public to anon, authenticated;

-- =====================================================================================================
-- ADMIN CUSTOMER CONTROLS (was drafted as 0096)
-- =====================================================================================================
-- Admin customer detail, edit and anonymize.
--
-- WHO MAY DO WHAT (enforced here, not only in the UI):
--   view      staff with the Customers page (and admin / super admin, who pass every page check);
--   edit      the same staff, except a customer's phone numbers, which are admin / super admin only;
--   disable   unchanged: the Customers page already suspends and reactivates with a reason;
--   anonymize admin / super admin only.
-- Every edit and anonymize writes audit_logs (who, when, before and after; phone numbers masked to
-- their last four digits).
--
-- PHONE AND tolo_phone_links. A customer's profiles.phone is user-editable and untrusted by design (0072):
-- the Tolo link table, not the profile, decides which account a verified phone belongs to. Editing a
-- profile phone here never reads or writes tolo_phone_links or profiles.phone_verified, so it cannot move
-- a verified phone to another account. It is refused outright if the new number is another account's
-- Tolo-verified phone, so a profile can never be made to display someone else's verified number.
--
-- ANONYMIZE, NOT ERASE. Orders, refunds and payouts keep their history. The person goes: name, phone,
-- avatar, email, sign-in and Tolo link; addresses an order used are overwritten in place (an order's
-- delivery record must keep pointing at a row) and the rest deleted; cart, favorites and notifications are
-- deleted. Reviews and support tickets stay, shown under "Deleted customer". It is refused while the
-- customer has an order in progress or a refund still pending, and for accounts that are staff or own a
-- merchant.

alter table profiles add column anonymized_at timestamptz;

-- An anonymized account stays dead: nothing a client sends can edit it or switch it back on.
create or replace function trg_guard_anonymized_profile()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if old.anonymized_at is not null and auth.uid() is not null then
    raise exception 'This account was deleted and can no longer be changed.';
  end if;
  return new;
end;
$$;

revoke execute on function trg_guard_anonymized_profile() from public, anon, authenticated;

create trigger profiles_guard_anonymized
  before update on profiles
  for each row execute function trg_guard_anonymized_profile();

-- Internal helpers for the admin functions in this and the next migration. Not callable by clients.
create or replace function admin_audit(p_action text, p_entity_type text, p_entity_id uuid, p_metadata jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  -- Only what a person did is worth a row (same rule as log_config_change(), 0085).
  if auth.uid() is not null then
    insert into audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), p_action, p_entity_type, p_entity_id, p_metadata);
  end if;
end;
$$;

create or replace function mask_last4(p_value text)
returns text
language sql immutable
as $$
  select case when p_value is null or p_value = '' then null else '••••' || right(p_value, 4) end;
$$;

revoke execute on function admin_audit(text, text, uuid, jsonb) from public, anon, authenticated;
revoke execute on function mask_last4(text) from public, anon, authenticated;

-- 1. Detail --------------------------------------------------------------------------------------
create or replace function admin_customer_detail(p_customer_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_profile profiles;
  v_admin boolean := is_tolo_admin();
  v_auth jsonb;
  v_tolo_phone text;
begin
  if not has_admin_page(array['customers']) then
    raise exception 'Not authorized';
  end if;

  select * into v_profile from profiles where id = p_customer_id and role = 'customer';
  if not found then
    raise exception 'customer_not_found';
  end if;

  select to_jsonb(u) into v_auth from auth.users u where u.id = p_customer_id;
  select phone into v_tolo_phone from tolo_phone_links where user_id = p_customer_id;

  return jsonb_build_object(
    'profile', to_jsonb(v_profile) - 'permissions' - 'admin_tier',
    'email', v_auth ->> 'email',
    'last_sign_in_at', v_auth ->> 'last_sign_in_at',
    'tolo_linked', v_tolo_phone is not null,
    -- The verified phone itself is shown to admin tier only; staff see that a link exists.
    'tolo_phone', case when v_admin then v_tolo_phone else mask_last4(v_tolo_phone) end,
    'addresses', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from addresses a where a.customer_id = p_customer_id), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', o.id, 'order_number', o.order_number, 'total', o.total, 'payment_status', o.payment_status, 'created_at', o.created_at,
               'statuses', (select coalesce(jsonb_agg(mo.status), '[]'::jsonb) from merchant_orders mo where mo.order_id = o.id)
             ) order by o.created_at desc)
      from (select * from orders where customer_id = p_customer_id order by created_at desc limit 100) o
    ), '[]'::jsonb),
    'order_count', (select count(*) from orders where customer_id = p_customer_id),
    'paid_total', coalesce((select sum(total) from orders where customer_id = p_customer_id and payment_status = 'paid'), 0),
    'refunds', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'amount', f.amount, 'status', f.status, 'created_at', f.created_at,
                                          'reason', r.reason, 'merchant_order_id', r.merchant_order_id) order by f.created_at desc)
      from refunds f join returns r on r.id = f.return_id where r.customer_id = p_customer_id
    ), '[]'::jsonb),
    'reviews', coalesce((select jsonb_agg(to_jsonb(rv) order by rv.created_at desc) from (select * from reviews where customer_id = p_customer_id order by created_at desc limit 50) rv), '[]'::jsonb),
    'cart_items', coalesce((select sum(ci.quantity) from carts c join cart_items ci on ci.cart_id = c.id where c.customer_id = p_customer_id), 0),
    'favorites', (select count(*) from customer_favorites where customer_id = p_customer_id),
    'audit', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'action', l.action, 'entity_type', l.entity_type, 'created_at', l.created_at,
                                          'actor', (select coalesce(p.full_name, p.username) from profiles p where p.id = l.actor_id),
                                          'metadata', l.metadata) order by l.created_at desc)
      from (
        select * from audit_logs
        where (entity_type = 'profiles' and entity_id = p_customer_id)
           or (entity_type = 'addresses' and entity_id in (select id from addresses where customer_id = p_customer_id))
        order by created_at desc limit 50
      ) l
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function admin_customer_detail(uuid) from public, anon;
grant execute on function admin_customer_detail(uuid) to authenticated, service_role;

-- 2. Edit ----------------------------------------------------------------------------------------
-- p_changes keys: full_name, email, phone (phone: admin / super admin only).
create or replace function admin_update_customer(p_customer_id uuid, p_changes jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_profile profiles;
  v_admin boolean := is_tolo_admin();
  v_key text;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_name text;
  v_email text;
  v_phone text;
  v_old_email text;
begin
  if auth.uid() is not null and not has_admin_page(array['customers']) then
    raise exception 'Not authorized';
  end if;

  select * into v_profile from profiles where id = p_customer_id and role = 'customer';
  if not found then
    raise exception 'customer_not_found';
  end if;
  if v_profile.anonymized_at is not null then
    raise exception 'This account was deleted and can no longer be changed.';
  end if;

  for v_key in select jsonb_object_keys(p_changes) loop
    if v_key not in ('full_name', 'email', 'phone') then
      raise exception 'unsupported_field';
    end if;
  end loop;

  if p_changes ? 'phone' and auth.uid() is not null and not v_admin then
    raise exception 'Only an admin or super admin can change a customer''s phone number.';
  end if;

  if p_changes ? 'full_name' then
    v_name := btrim(p_changes ->> 'full_name');
    if v_name is null or char_length(v_name) not between 1 and 120 then
      raise exception 'invalid_name';
    end if;
    if v_name is distinct from v_profile.full_name then
      v_before := v_before || jsonb_build_object('full_name', v_profile.full_name);
      v_after := v_after || jsonb_build_object('full_name', v_name);
      update profiles set full_name = v_name where id = p_customer_id;
    end if;
  end if;

  if p_changes ? 'phone' then
    v_phone := nullif(btrim(p_changes ->> 'phone'), '');
    if v_phone is not null and v_phone !~ '^\+?[0-9]{7,15}$' then
      raise exception 'invalid_phone';
    end if;
    -- Never let a profile show a number the Tolo backend verified for someone else.
    if v_phone is not null and exists (
      select 1 from tolo_phone_links l
      where regexp_replace(l.phone, '[^0-9]', '', 'g') = regexp_replace(v_phone, '[^0-9]', '', 'g') and l.user_id <> p_customer_id
    ) then
      raise exception 'phone_linked_to_another_account';
    end if;
    if v_phone is distinct from v_profile.phone then
      v_before := v_before || jsonb_build_object('phone', mask_last4(v_profile.phone));
      v_after := v_after || jsonb_build_object('phone', mask_last4(v_phone));
      -- Only the profile's own, untrusted phone. tolo_phone_links and phone_verified are left alone.
      update profiles set phone = v_phone where id = p_customer_id;
    end if;
  end if;

  if p_changes ? 'email' then
    v_email := lower(btrim(coalesce(p_changes ->> 'email', '')));
    if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
      raise exception 'invalid_email';
    end if;
    select email into v_old_email from auth.users where id = p_customer_id;
    if v_email is distinct from lower(coalesce(v_old_email, '')) then
      if exists (select 1 from auth.users where lower(email) = v_email and id <> p_customer_id) then
        raise exception 'email_already_used';
      end if;
      v_before := v_before || jsonb_build_object('email', v_old_email);
      v_after := v_after || jsonb_build_object('email', v_email);
      update auth.users set email = v_email where id = p_customer_id;
    end if;
  end if;

  if v_after <> '{}'::jsonb then
    perform admin_audit('update', 'profiles', p_customer_id, jsonb_build_object('before', v_before, 'after', v_after));
  end if;
end;
$$;

revoke execute on function admin_update_customer(uuid, jsonb) from public, anon;
grant execute on function admin_update_customer(uuid, jsonb) to authenticated, service_role;

-- p_changes keys: label, recipient_name, line1, line2, city, region, landmark, sub_city, phone (admin / super admin only).
create or replace function admin_update_customer_address(p_address_id uuid, p_changes jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_row addresses;
  v_key text;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_old jsonb;
  v_new text;
begin
  if auth.uid() is not null and not has_admin_page(array['customers']) then
    raise exception 'Not authorized';
  end if;

  select * into v_row from addresses where id = p_address_id;
  if not found then
    raise exception 'address_not_found';
  end if;
  if exists (select 1 from profiles where id = v_row.customer_id and anonymized_at is not null) then
    raise exception 'This account was deleted and can no longer be changed.';
  end if;

  v_old := to_jsonb(v_row);
  for v_key in select jsonb_object_keys(p_changes) loop
    if v_key not in ('label', 'recipient_name', 'line1', 'line2', 'city', 'region', 'landmark', 'sub_city', 'phone') then
      raise exception 'unsupported_field';
    end if;
    if v_key = 'phone' and auth.uid() is not null and not is_tolo_admin() then
      raise exception 'Only an admin or super admin can change a delivery phone number.';
    end if;
    v_new := nullif(btrim(p_changes ->> v_key), '');
    if v_key in ('recipient_name', 'line1', 'city') and v_new is null then
      raise exception 'invalid_address';
    end if;
    if v_new is distinct from (v_old ->> v_key) then
      v_before := v_before || jsonb_build_object(v_key, case when v_key = 'phone' then to_jsonb(mask_last4(v_old ->> v_key)) else v_old -> v_key end);
      v_after := v_after || jsonb_build_object(v_key, case when v_key = 'phone' then to_jsonb(mask_last4(v_new)) else to_jsonb(v_new) end);
      execute format('update addresses set %I = $1 where id = $2', v_key) using v_new, p_address_id;
    end if;
  end loop;

  if v_after <> '{}'::jsonb then
    perform admin_audit('update', 'addresses', p_address_id, jsonb_build_object('before', v_before, 'after', v_after, 'customer_id', v_row.customer_id));
  end if;
end;
$$;

revoke execute on function admin_update_customer_address(uuid, jsonb) from public, anon;
grant execute on function admin_update_customer_address(uuid, jsonb) to authenticated, service_role;

-- 3. Anonymize -------------------------------------------------------------------------------------
create or replace function admin_anonymize_customer(p_customer_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_profile profiles;
  v_sets text[] := array[format('email = %L', 'deleted-' || p_customer_id || '@deleted.invalid')];
  v_addresses_kept int;
  v_addresses_deleted int;
begin
  if auth.uid() is not null and not is_tolo_admin() then
    raise exception 'Only an admin or super admin can delete a customer.';
  end if;

  select * into v_profile from profiles where id = p_customer_id for update;
  if not found or v_profile.role <> 'customer' then
    raise exception 'customer_not_found';
  end if;
  if v_profile.anonymized_at is not null then
    raise exception 'already_deleted';
  end if;
  if v_profile.admin_tier is not null then
    raise exception 'customer_not_found';
  end if;
  if exists (select 1 from merchants where owner_id = p_customer_id)
     or exists (select 1 from merchant_staff where user_id = p_customer_id) then
    raise exception 'customer_is_merchant_account';
  end if;

  -- Money and parcels in flight must settle first.
  if exists (
    select 1 from merchant_orders mo join orders o on o.id = mo.order_id
    where o.customer_id = p_customer_id
      and mo.status in ('new', 'accepted', 'processing', 'ready_for_pickup', 'picked_up', 'delivered')
  ) then
    raise exception 'customer_has_active_orders';
  end if;
  if exists (
    select 1 from refunds f join returns r on r.id = f.return_id
    where r.customer_id = p_customer_id and f.status = 'pending'
  ) then
    raise exception 'customer_has_pending_refunds';
  end if;

  -- The person.
  update profiles
  set full_name = 'Deleted customer', phone = null, avatar_url = null, phone_verified = false,
      referral_code = null, account_status = 'suspended', suspension_reason = 'Account deleted',
      anonymized_at = now()
  where id = p_customer_id;

  -- Addresses: an order keeps pointing at its row, so those are overwritten; the rest go.
  update addresses
  set label = null, recipient_name = 'Deleted customer', phone = null, line1 = 'Removed', line2 = null, landmark = null,
      sub_city = null, latitude = null, longitude = null, is_default = false
  where customer_id = p_customer_id and id in (select address_id from orders where customer_id = p_customer_id);
  get diagnostics v_addresses_kept = row_count;
  delete from addresses
  where customer_id = p_customer_id and id not in (select address_id from orders where customer_id = p_customer_id);
  get diagnostics v_addresses_deleted = row_count;

  -- The Tolo link: gone, so the verified phone is free and nothing can sign in to this account through it.
  delete from tolo_phone_links where user_id = p_customer_id;
  delete from carts where customer_id = p_customer_id;
  delete from customer_favorites where customer_id = p_customer_id;
  delete from notifications where user_id = p_customer_id;

  -- Sign-in: no email, no phone, no password, banned for good, and every session and token revoked. Columns are
  -- looked up so this works on any auth schema version.
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'phone') then
    v_sets := array_append(v_sets, 'phone = null');
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'encrypted_password') then
    v_sets := array_append(v_sets, $q$encrypted_password = ''$q$);
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'raw_user_meta_data') then
    v_sets := array_append(v_sets, $q$raw_user_meta_data = '{}'::jsonb$q$);
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'banned_until') then
    v_sets := array_append(v_sets, $q$banned_until = 'infinity'::timestamptz$q$);
  end if;
  execute format('update auth.users set %s where id = %L', array_to_string(v_sets, ', '), p_customer_id);

  if to_regclass('auth.sessions') is not null then
    execute 'delete from auth.sessions where user_id = $1' using p_customer_id;
  end if;
  if to_regclass('auth.refresh_tokens') is not null then
    execute 'delete from auth.refresh_tokens where user_id = $1::text' using p_customer_id;
  end if;
  if to_regclass('auth.identities') is not null then
    execute 'delete from auth.identities where user_id = $1' using p_customer_id;
  end if;

  perform admin_audit('anonymize', 'profiles', p_customer_id,
                      jsonb_build_object('addresses_overwritten', v_addresses_kept, 'addresses_deleted', v_addresses_deleted));

  return jsonb_build_object('addresses_overwritten', v_addresses_kept, 'addresses_deleted', v_addresses_deleted);
end;
$$;

revoke execute on function admin_anonymize_customer(uuid) from public, anon;
grant execute on function admin_anonymize_customer(uuid) to authenticated, service_role;

-- =====================================================================================================
-- ADMIN MERCHANT CONTROLS (was drafted as 0097)
-- =====================================================================================================
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
