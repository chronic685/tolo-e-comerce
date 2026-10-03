-- delete_qa_orders() (0082) checked every order in the batch, but all-or-nothing:
-- one order with a wallet row or a settled payment made the whole call fail,
-- which makes it useless for clearing thousands of test orders. This splits the
-- checks into a per-order qa_order_blocker() and gives delete_qa_orders() a bulk
-- mode that skips ineligible orders (and says how many) instead of aborting.
-- Strict mode (the default) behaves exactly as before.
--
-- qa_order_blocker(order_id) returns null when the order may be deleted, else
-- why not: order_not_found, not_a_test_order, has_references, payment_settled,
-- stock_already_sold. The rules are the same ones 0082 documents.
create or replace function qa_order_blocker(p_order_id uuid)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  v_mo_ids uuid[];
begin
  if not exists (select 1 from orders where id = p_order_id) then
    return 'order_not_found';
  end if;

  select coalesce(array_agg(id), '{}') into v_mo_ids from merchant_orders where order_id = p_order_id;

  if exists (
    select 1 from merchant_orders mo join merchants m on m.id = mo.merchant_id
    where mo.order_id = p_order_id and not m.is_test
  ) then
    return 'not_a_test_order';
  end if;

  if exists (select 1 from wallet_transactions where merchant_order_id = any(v_mo_ids))
     or exists (select 1 from settlement_items where merchant_order_id = any(v_mo_ids))
     or exists (select 1 from financial_adjustments where order_id = p_order_id)
     or exists (select 1 from discount_redemptions where order_id = p_order_id)
     or exists (select 1 from reviews where merchant_order_id = any(v_mo_ids))
     or exists (select 1 from returns where merchant_order_id = any(v_mo_ids))
     or exists (select 1 from support_tickets where merchant_order_id = any(v_mo_ids)) then
    return 'has_references';
  end if;

  if exists (
    select 1 from payments p
    where p.order_id = p_order_id
      and (p.status in ('verified', 'refunded') or exists (select 1 from payment_transactions t where t.payment_id = p.id))
  ) then
    return 'payment_settled';
  end if;

  if exists (
    select 1 from inventory_movements
    where reference_type = 'order' and reference_id = p_order_id and movement_type in ('sale', 'return')
  ) then
    return 'stock_already_sold';
  end if;

  return null;
end;
$$;

revoke execute on function qa_order_blocker(uuid) from public, anon, authenticated;
grant execute on function qa_order_blocker(uuid) to service_role;

drop function delete_qa_orders(uuid[]);

-- p_skip_ineligible = false (default): any order that can't be deleted aborts
-- the whole call with that order's reason, deleting nothing.
-- p_skip_ineligible = true: those orders are left alone and counted in
-- orders_skipped; the rest are deleted. Either way every order is checked
-- individually, and the checks run in the same transaction as the delete.
-- Error codes (strict mode): no_orders plus the blocker reasons above.
create or replace function delete_qa_orders(p_order_ids uuid[], p_skip_ineligible boolean default false)
returns table (orders_deleted int, notifications_deleted int, reservations_released int, orders_skipped int)
language plpgsql security definer set search_path = public
as $$
declare
  v_requested uuid[];
  v_ids uuid[] := '{}';
  v_id uuid;
  v_blocker text;
  v_reserved record;
  v_released int := 0;
  v_notified int := 0;
  v_deleted int := 0;
  v_skipped int := 0;
begin
  select coalesce(array_agg(distinct x), '{}') into v_requested from unnest(p_order_ids) as x where x is not null;
  if cardinality(v_requested) = 0 then
    raise exception 'no_orders';
  end if;

  foreach v_id in array v_requested loop
    v_blocker := qa_order_blocker(v_id);
    if v_blocker is null then
      v_ids := v_ids || v_id;
    elsif p_skip_ineligible then
      v_skipped := v_skipped + 1;
    else
      raise exception '%', v_blocker;
    end if;
  end loop;

  if cardinality(v_ids) = 0 then
    return query select 0, 0, 0, v_skipped;
    return;
  end if;

  -- Give back the stock still held for these orders.
  for v_reserved in
    select variant_id, reference_id,
           sum(case movement_type when 'reserve' then quantity when 'release' then -quantity else 0 end)::int as held
    from inventory_movements
    where reference_type = 'order' and reference_id = any(v_ids)
    group by variant_id, reference_id
  loop
    if v_reserved.held > 0 then
      perform release_stock(v_reserved.variant_id, v_reserved.held, v_reserved.reference_id, false);
      v_released := v_released + v_reserved.held;
    end if;
  end loop;
  delete from inventory_movements where reference_type = 'order' and reference_id = any(v_ids);

  delete from notifications n
  using orders o
  where o.id = any(v_ids)
    and n.user_id = o.customer_id
    and n.type like 'order\_%'
    and n.body ~ ('\yTL-' || o.order_number || '\y');
  get diagnostics v_notified = row_count;

  delete from orders where id = any(v_ids);
  get diagnostics v_deleted = row_count;

  return query select v_deleted, v_notified, v_released, v_skipped;
end;
$$;

revoke execute on function delete_qa_orders(uuid[], boolean) from public, anon, authenticated;
grant execute on function delete_qa_orders(uuid[], boolean) to service_role;
