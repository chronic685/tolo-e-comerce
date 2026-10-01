-- Which marketplace account a Tolo-verified phone signs in to.
--
-- tolo-app-login used to match accounts by profiles.phone. Every account
-- can rewrite its own profiles row, phone included (profiles_update_own,
-- migrations 0014/0052), so anyone could set their profile phone to a
-- victim's number and the victim's next Tolo-app login would land in the
-- attacker's account -- along with whatever the victim then did there
-- (orders, addresses, a merchant application).
--
-- The link now lives in its own table that no user can write at all: rows
-- are created only by link_tolo_phone(), called by tolo-app-login after
-- the Tolo backend has verified the phone. profiles.phone stays a
-- display-only, self-editable field and is never read for matching.
create table tolo_phone_links (
  user_id uuid primary key references profiles(id) on delete cascade,
  -- One account per Tolo phone, one Tolo phone per account.
  phone text not null unique check (phone ~ '^\+251[79][0-9]{8}$'),
  linked_at timestamptz not null default now(),
  last_login_at timestamptz not null default now()
);

alter table tolo_phone_links enable row level security;

-- An account may see its own link (e.g. to show "signed in with Tolo").
-- No insert/update/delete policy for anyone: only the service role, which
-- bypasses RLS, writes here -- and the grants are revoked as well, so even
-- a future permissive policy wouldn't open a write path by accident.
create policy tolo_phone_links_select_own on tolo_phone_links
  for select using (user_id = auth.uid());
revoke insert, update, delete, truncate on tolo_phone_links from anon, authenticated;

-- The one lookup login matching uses.
create or replace function tolo_account_for_phone(p_phone text)
returns table (user_id uuid, is_staff_or_admin boolean)
language sql stable security definer set search_path = public
as $$
  select l.user_id,
         (p.admin_tier is not null or p.role::text like 'tolo\_%')
  from tolo_phone_links l
  join profiles p on p.id = l.user_id
  where l.phone = p_phone;
$$;

-- Links a freshly created account to the verified phone it was created
-- for. Raises phone_already_linked if another account won a concurrent
-- first login for the same phone (the caller then discards its account).
create or replace function link_tolo_phone(p_user_id uuid, p_phone text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  insert into tolo_phone_links (user_id, phone) values (p_user_id, p_phone);
exception
  when unique_violation then
    raise exception 'phone_already_linked';
end;
$$;

create or replace function record_tolo_login(p_user_id uuid)
returns void
language sql
security definer set search_path = public
as $$
  update tolo_phone_links set last_login_at = now() where user_id = p_user_id;
$$;

revoke execute on function tolo_account_for_phone(text) from public, anon, authenticated;
revoke execute on function link_tolo_phone(uuid, text) from public, anon, authenticated;
revoke execute on function record_tolo_login(uuid) from public, anon, authenticated;
grant execute on function tolo_account_for_phone(text) to service_role;
grant execute on function link_tolo_phone(uuid, text) to service_role;
grant execute on function record_tolo_login(uuid) to service_role;
