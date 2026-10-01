-- Merchant sign-in from the Tolo app's "Merchant" button
-- (tolo-merchant-login, docs/integration/tolo-app.md). The merchant
-- equivalent of tolo_account_for_phone() (migration 0072), with the same
-- hardened matching: the phone resolves to an account ONLY through
-- tolo_phone_links, which no user can write -- never through the
-- self-editable profiles.phone.
--
-- On top of that link, it only answers for a merchant that came through
-- the merchant application flow and is still the linked account's:
--   - the phone's latest application (migration 0073) is 'approved' -- not
--     pending, not rejected;
--   - that application's merchant is owned by the linked account;
--   - the linked account isn't platform staff/admin.
-- Anything else returns no row, and the login fails generically. This
-- never creates an account: a phone with no link has nothing to sign in to.
create or replace function tolo_merchant_account_for_phone(p_phone text)
returns table (user_id uuid, merchant_id uuid)
language sql stable security definer set search_path = public
as $$
  select l.user_id, m.id
  from tolo_phone_links l
  join profiles p on p.id = l.user_id
  join lateral (
    select a.status, a.merchant_id
    from merchant_applications a
    where a.applicant_phone = l.phone
    order by a.created_at desc
    limit 1
  ) latest on true
  join merchants m on m.id = latest.merchant_id and m.owner_id = l.user_id
  where l.phone = p_phone
    and latest.status = 'approved'
    and p.admin_tier is null
    and p.role::text not like 'tolo\_%';
$$;

revoke execute on function tolo_merchant_account_for_phone(text) from public, anon, authenticated;
grant execute on function tolo_merchant_account_for_phone(text) to service_role;
