-- Fix for a bug in migration 0065 (out-of-stock substitution choice):
-- resolve_unavailable_order_item() contained its own
--   if not is_merchant_member(v_mo.merchant_id) and not is_tolo_staff() then
--     raise exception 'Not authorized to modify this order';
--   end if;
-- but both is_merchant_member() and is_tolo_staff() resolve against
-- auth.uid() (migration 0013), and this function's own trailing comment
-- says it is "called only via the resolve-order-item Edge Function
-- (service role), which does the real authorization check in
-- TypeScript" -- under the service-role client auth.uid() is always
-- null, so this check could never pass for ANY caller, including a
-- legitimate merchant acting on their own order. Every call -- through
-- the Edge Function or the direct RPC (revoked from
-- public/anon/authenticated, so only reachable this way regardless) --
-- hit this exception first and failed, no matter who called it.
-- Caught by CI against a fresh migration (the live local sandbox this
-- repo's tests otherwise run against, see tests/README.md, was running
-- an older/patched definition that didn't hit this).
--
-- Removes the dead check; resolve-order-item/index.ts's own
-- merchant_staff/owner_id lookup (with a real authenticated user's
-- auth.uid()) remains the actual authorization boundary, exactly as this
-- function's own comment already documented.
create or replace function resolve_unavailable_order_item(
  p_order_item_id uuid, p_action text, p_substitute_variant_id uuid default null, p_note text default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_item order_items%rowtype;
  v_mo merchant_orders%rowtype;
  v_order_number int;
  v_customer_id uuid;
  v_payment_status order_payment_status;
  v_merchant_name text;
  v_return_id uuid;
  v_sub record;
  v_new_unit_price numeric;
  v_new_merchant_unit_price numeric;
  v_new_subtotal numeric;
  v_new_merchant_subtotal numeric;
  v_subtotal_delta numeric;
  v_merchant_subtotal_delta numeric;
  v_refund_note text;
begin
  if p_action not in ('remove', 'substitute') then
    raise exception 'Unsupported action: %', p_action;
  end if;

  select * into v_item from order_items where id = p_order_item_id;
  if not found then
    raise exception 'Order item not found';
  end if;
  if v_item.item_status <> 'active' then
    raise exception 'This item has already been resolved.';
  end if;

  select * into v_mo from merchant_orders where id = v_item.merchant_order_id;
  if v_mo.status not in ('new', 'accepted', 'processing') then
    raise exception 'This order can no longer be modified.';
  end if;

  select o.customer_id, o.order_number, o.payment_status
  into v_customer_id, v_order_number, v_payment_status
  from orders o where o.id = v_mo.order_id;

  select business_name into v_merchant_name from merchants where id = v_mo.merchant_id;

  if p_action = 'remove' then
    perform release_stock(v_item.variant_id, v_item.quantity, v_mo.order_id, false);

    update order_items
    set item_status = 'removed', resolution_note = coalesce(p_note, 'Removed — item unavailable')
    where id = p_order_item_id;

    update merchant_orders
    set subtotal = subtotal - v_item.subtotal,
        merchant_subtotal = merchant_subtotal - v_item.merchant_subtotal,
        merchant_payable = merchant_payable - v_item.merchant_subtotal,
        commission_amount = commission_amount - (v_item.subtotal - v_item.merchant_subtotal)
    where id = v_mo.id;

    update orders set subtotal = subtotal - v_item.subtotal, total = total - v_item.subtotal where id = v_mo.order_id;

    v_refund_note := 'Not refunded (order was not yet paid).';
    if v_payment_status = 'paid' then
      insert into returns (merchant_order_id, customer_id, reason, status, order_item_id)
      values (v_mo.id, v_customer_id, coalesce(p_note, 'Item unavailable — removed at fulfillment'), 'approved', p_order_item_id)
      returning id into v_return_id;

      insert into refunds (return_id, amount, status) values (v_return_id, v_item.subtotal, 'pending');
      v_refund_note := 'You will be refunded ' || v_item.subtotal || ' ETB for this item.';
    end if;

    begin
      insert into notifications (user_id, type, title, body)
      select
        v_customer_id,
        t.event_type,
        t.title_template,
        replace(
          replace(replace(replace(t.body_template, '{{product_name}}', v_item.product_name_snapshot), '{{order_number}}', 'TL-' || v_order_number),
            '{{merchant_name}}', coalesce(v_merchant_name, 'the merchant')),
          '{{refund_note}}', v_refund_note
        )
      from notification_templates t
      where t.event_type = 'order_item_removed' and t.channel = 'in_app' and t.language = 'en' and t.enabled;
    exception when others then
      raise warning 'resolve_unavailable_order_item: notification failed for item %: %', p_order_item_id, sqlerrm;
    end;

  elsif p_action = 'substitute' then
    if p_substitute_variant_id is null then
      raise exception 'A substitute product is required.';
    end if;

    select pv.id as variant_id, pv.price, pv.discount_price, pv.attributes,
           p.id as product_id, p.name as product_name, p.status as product_status, p.merchant_id
    into v_sub
    from product_variants pv join products p on p.id = pv.product_id
    where pv.id = p_substitute_variant_id;

    if not found or v_sub.merchant_id <> v_mo.merchant_id then
      raise exception 'The replacement product must be one of your own.';
    end if;
    if v_sub.product_status <> 'published' then
      raise exception 'The replacement product is not currently published.';
    end if;

    perform release_stock(v_item.variant_id, v_item.quantity, v_mo.order_id, false);
    perform reserve_stock(p_substitute_variant_id, v_item.quantity, v_mo.order_id);

    v_new_merchant_unit_price := coalesce(v_sub.discount_price, v_sub.price);
    v_new_unit_price := round(v_new_merchant_unit_price * (1 + v_mo.commission_rate_applied / 100), 2);
    v_new_subtotal := v_item.quantity * v_new_unit_price;
    v_new_merchant_subtotal := v_item.quantity * v_new_merchant_unit_price;
    v_subtotal_delta := v_new_subtotal - v_item.subtotal;
    v_merchant_subtotal_delta := v_new_merchant_subtotal - v_item.merchant_subtotal;

    update order_items
    set variant_id = v_sub.variant_id,
        product_name_snapshot = v_sub.product_name,
        variant_attributes_snapshot = v_sub.attributes,
        unit_price = v_new_unit_price,
        merchant_unit_price = v_new_merchant_unit_price,
        subtotal = v_new_subtotal,
        merchant_subtotal = v_new_merchant_subtotal,
        item_status = 'substituted',
        resolution_note = coalesce(p_note, 'Substituted for an unavailable item')
    where id = p_order_item_id;

    update merchant_orders
    set subtotal = subtotal + v_subtotal_delta,
        merchant_subtotal = merchant_subtotal + v_merchant_subtotal_delta,
        merchant_payable = merchant_payable + v_merchant_subtotal_delta,
        commission_amount = commission_amount + (v_subtotal_delta - v_merchant_subtotal_delta)
    where id = v_mo.id;

    update orders set subtotal = subtotal + v_subtotal_delta, total = total + v_subtotal_delta where id = v_mo.order_id;

    if v_subtotal_delta < 0 and v_payment_status = 'paid' then
      insert into returns (merchant_order_id, customer_id, reason, status, order_item_id)
      values (v_mo.id, v_customer_id, coalesce(p_note, 'Cheaper substitute applied at fulfillment'), 'approved', p_order_item_id)
      returning id into v_return_id;

      insert into refunds (return_id, amount, status) values (v_return_id, -v_subtotal_delta, 'pending');
    end if;

    begin
      insert into notifications (user_id, type, title, body)
      select
        v_customer_id,
        t.event_type,
        t.title_template,
        replace(
          replace(replace(replace(t.body_template, '{{product_name}}', v_item.product_name_snapshot), '{{order_number}}', 'TL-' || v_order_number),
            '{{merchant_name}}', coalesce(v_merchant_name, 'the merchant')),
          '{{new_product_name}}', v_sub.product_name
        )
      from notification_templates t
      where t.event_type = 'order_item_substituted' and t.channel = 'in_app' and t.language = 'en' and t.enabled;
    exception when others then
      raise warning 'resolve_unavailable_order_item: notification failed for item %: %', p_order_item_id, sqlerrm;
    end;
  end if;
end;
$$;

revoke execute on function resolve_unavailable_order_item(uuid, text, uuid, text) from public, anon, authenticated;
