-- Orders are append-only everywhere else in this schema (no delete policy, no
-- delete function), but the test suite creates real orders against the one live
-- project (see tests/README.md) and nothing could ever remove them. This is the
-- one deliberate delete path, and it is deliberately narrow:
--
--   * service_role only (never callable by users, anon or the dashboards);
--   * only orders whose every merchant order belongs to an is_test merchant
--     (the QA fixtures, migration 0079) -- a real merchant's order is refused;
--   * refuses, and deletes nothing, if anything financial or customer-facing
--     refers to the order: wallet/settlement/adjustment/discount rows, payment
--     transactions or a settled payment, reviews, returns, support tickets, or
--     stock that was already sold. Those need a human, not a cleanup.
--
-- It also gives back what the order held: stock reserved at checkout is released
-- through the real release_stock(), then the order's inventory movements (the
-- reserve and the release) and its notifications are removed so nothing is left
-- pointing at an order that no longer exists. Everything else hanging off the
-- order (items, status history, payments, deliveries, delivery_jobs) goes with
-- it through the existing ON DELETE CASCADE foreign keys.
--
-- Error codes: no_orders, order_not_found, not_a_test_order, has_references,
-- payment_settled, stock_already_sold.
create or replace function delete_qa_orders(p_order_ids uuid[])
returns table (orders_deleted int, notifications_deleted int, reservations_released int)
language plpgsql security definer set search_path = public
as $$
declare
  v_ids uuid[];
  v_mo_ids uuid[];
  v_reserved record;
  v_released int := 0;
  v_notified int := 0;
  v_deleted int := 0;
begin
  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(p_order_ids) as x where x is not null;
  if cardinality(v_ids) = 0 then
    raise exception 'no_orders';
  end if;
  if (select count(*) from orders where id = any(v_ids)) <> cardinality(v_ids) then
    raise exception 'order_not_found';
  end if;

  select array_agg(id) into v_mo_ids from merchant_orders where order_id = any(v_ids);

  if exists (
    select 1 from merchant_orders mo join merchants m on m.id = mo.merchant_id
    where mo.order_id = any(v_ids) and not m.is_test
  ) then
    raise exception 'not_a_test_order';
  end if;

  if exists (select 1 from wallet_transactions where merchant_order_id = any(coalesce(v_mo_ids, '{}')))
     or exists (select 1 from settlement_items where merchant_order_id = any(coalesce(v_mo_ids, '{}')))
     or exists (select 1 from financial_adjustments where order_id = any(v_ids))
     or exists (select 1 from discount_redemptions where order_id = any(v_ids))
     or exists (select 1 from reviews where merchant_order_id = any(coalesce(v_mo_ids, '{}')))
     or exists (select 1 from returns where merchant_order_id = any(coalesce(v_mo_ids, '{}')))
     or exists (select 1 from support_tickets where merchant_order_id = any(coalesce(v_mo_ids, '{}'))) then
    raise exception 'has_references';
  end if;

  if exists (
    select 1 from payments p
    where p.order_id = any(v_ids)
      and (p.status in ('verified', 'refunded') or exists (select 1 from payment_transactions t where t.payment_id = p.id))
  ) then
    raise exception 'payment_settled';
  end if;

  if exists (
    select 1 from inventory_movements
    where reference_type = 'order' and reference_id = any(v_ids) and movement_type in ('sale', 'return')
  ) then
    raise exception 'stock_already_sold';
  end if;

  -- Give back the stock still held for these orders.
  for v_reserved in
    select variant_id,
           sum(case movement_type when 'reserve' then quantity when 'release' then -quantity else 0 end)::int as held
    from inventory_movements
    where reference_type = 'order' and reference_id = any(v_ids)
    group by variant_id
  loop
    if v_reserved.held > 0 then
      perform release_stock(v_reserved.variant_id, v_reserved.held, v_ids[1], false);
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

  return query select v_deleted, v_notified, v_released;
end;
$$;

revoke execute on function delete_qa_orders(uuid[]) from public, anon, authenticated;
grant execute on function delete_qa_orders(uuid[]) to service_role;
