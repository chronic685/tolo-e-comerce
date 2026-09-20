-- Phase 5d, item 7: a return never restocked inventory. return_status
-- already had 'received' (physical item back at the merchant) and
-- inventory_movements already had 'restock' as movement types — neither was
-- ever used. returns.merchant_order_id covers the whole order (there is no
-- return_items table), so restocking walks every order_item on that
-- merchant_order, same as order-status's cancel/reject release_stock loop
-- walks order_items to find variant_id/quantity.
--
-- Implemented as a trigger on returns, mirroring migration 0034's
-- claw_back_wallet_on_refund_completed trigger on refunds: the admin
-- Refunds.tsx page just does a plain `.update()` on returns.status, so the
-- restock must happen no matter which client sets a return to "received",
-- not depend on every future caller remembering an RPC.
create or replace function restock_on_return_received()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_item record;
begin
  for v_item in
    select variant_id, quantity
    from order_items
    where merchant_order_id = new.merchant_order_id
  loop
    update inventory
    set stock_quantity = stock_quantity + v_item.quantity
    where variant_id = v_item.variant_id;

    insert into inventory_movements (variant_id, movement_type, quantity, reference_type, reference_id)
    values (v_item.variant_id, 'restock', v_item.quantity, 'return', new.id);
  end loop;

  return new;
end;
$$;

-- Guarded by OLD.status distinct from 'received' on the update trigger so
-- restocking only fires once per return, the same double-fire guard 0034
-- uses for the wallet clawback.
create trigger returns_restock_on_insert
  after insert on returns
  for each row
  when (new.status = 'received')
  execute function restock_on_return_received();

create trigger returns_restock_on_update
  after update on returns
  for each row
  when (new.status = 'received' and old.status is distinct from 'received')
  execute function restock_on_return_received();
