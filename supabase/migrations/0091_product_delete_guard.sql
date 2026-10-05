-- A merchant can delete a product only if no order has ever referenced it.
--
-- order_items.variant_id is ON DELETE RESTRICT (0007), so the database already
-- refuses to delete a product whose variants were ordered, but with a raw
-- foreign-key error. This makes the rule explicit: product_has_orders() lets the
-- apps ask first ("Delete" or "Archive instead"), and a BEFORE DELETE trigger
-- refuses with a readable message and writes an audit row when a person deletes.

-- True when any order item points at any variant of the product. Callers must be
-- a member of the product's merchant or admin staff with the Products page, so
-- this cannot be used to probe other merchants' sales. (auth.uid() is null for
-- the service role and for the trigger below, which are trusted.)
create or replace function product_has_orders(p_product_id uuid)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
begin
  if auth.uid() is not null
     and not (is_merchant_member(merchant_id_for_product(p_product_id)) or has_admin_page(array['products'])) then
    raise exception 'Not authorized for this product';
  end if;
  return exists (
    select 1
    from order_items oi
    join product_variants pv on pv.id = oi.variant_id
    where pv.product_id = p_product_id
  );
end;
$$;

revoke execute on function product_has_orders(uuid) from public, anon;
grant execute on function product_has_orders(uuid) to authenticated, service_role;

create or replace function trg_guard_product_delete()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if product_has_orders(old.id) then
    raise exception 'This product has been ordered, so it cannot be deleted. Archive it instead.';
  end if;

  -- Only deletions a person made are worth an audit row (same rule as
  -- log_config_change(), migration 0085).
  if auth.uid() is not null then
    insert into audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'delete', 'products', old.id, jsonb_build_object('name', old.name, 'merchant_id', old.merchant_id, 'status', old.status));
  end if;
  return old;
end;
$$;

-- Trigger functions are never called directly; keep them off the default PUBLIC grant
-- (see tests/unit/function-privileges.test.ts). The trigger still fires.
revoke execute on function trg_guard_product_delete() from public, anon, authenticated;

create trigger products_guard_delete
  before delete on products
  for each row execute function trg_guard_product_delete();
