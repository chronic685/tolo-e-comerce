-- delete_qa_orders() (0083) released each order's held stock in full, taken from
-- the inventory_movements ledger. On live that ledger has drifted above
-- inventory.reserved_quantity (other code paths release stock without a matching
-- movement), so a bulk run tried to push reserved_quantity below zero and the
-- check constraint rolled the batch back. It now releases at most what is
-- actually reserved. Nothing else changes.
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
  v_to_release int;
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
    -- Never release more than is actually reserved: the movements ledger can
    -- say more is held than inventory.reserved_quantity does (other code paths
    -- release stock without a matching movement), and pushing the counter
    -- below zero would violate its check constraint.
    v_to_release := least(v_reserved.held, coalesce((select reserved_quantity from inventory where variant_id = v_reserved.variant_id), 0));
    if v_to_release > 0 then
      perform release_stock(v_reserved.variant_id, v_to_release, v_reserved.reference_id, false);
      v_released := v_released + v_to_release;
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
