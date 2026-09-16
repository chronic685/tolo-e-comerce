-- Security-definer helpers used by RLS policies. They bypass RLS themselves
-- (search_path pinned, definer-owned) so policies can call them without recursion.

create or replace function is_tolo_staff()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role in ('tolo_ops', 'tolo_finance', 'tolo_admin')
  );
$$;

create or replace function is_tolo_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'tolo_admin'
  );
$$;

create or replace function is_tolo_finance()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role in ('tolo_finance', 'tolo_admin')
  );
$$;

create or replace function is_merchant_member(p_merchant_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from merchants where id = p_merchant_id and owner_id = auth.uid()
  ) or exists (
    select 1 from merchant_staff where merchant_id = p_merchant_id and user_id = auth.uid()
  );
$$;

create or replace function merchant_id_for_product(p_product_id uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select merchant_id from products where id = p_product_id;
$$;

create or replace function merchant_id_for_variant(p_variant_id uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select p.merchant_id from product_variants v join products p on p.id = v.product_id
  where v.id = p_variant_id;
$$;

create or replace function merchant_id_for_merchant_order(p_merchant_order_id uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select merchant_id from merchant_orders where id = p_merchant_order_id;
$$;

create or replace function order_owner(p_order_id uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select customer_id from orders where id = p_order_id;
$$;

create or replace function order_owner_for_merchant_order(p_merchant_order_id uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select o.customer_id from merchant_orders mo join orders o on o.id = mo.order_id
  where mo.id = p_merchant_order_id;
$$;

-- Prevent users from escalating their own platform role via a self-update.
create or replace function prevent_role_self_escalation()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.role <> old.role and not is_tolo_admin() then
    raise exception 'Only tolo_admin can change platform roles';
  end if;
  return new;
end;
$$;

create trigger profiles_prevent_role_escalation
  before update on profiles
  for each row execute function prevent_role_self_escalation();
