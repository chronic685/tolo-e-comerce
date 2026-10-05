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
