-- Group 4, item 15: "Out-of-stock substitution choice at checkout
-- (substitute/remove/cancel item), enforced server-side when fulfilling."
--
-- What "out of stock" means here: create_order() already reserves stock
-- atomically for every item at checkout (reserve_stock(), migration
-- 0005), so a cart item can never be placed against stock that doesn't
-- exist at that moment -- the gap this closes is the one between
-- checkout and fulfillment, where the merchant's real, physical stock
-- turns out to be short of what the system had reserved (a stale count,
-- damaged stock, etc). Today a merchant who can't actually ship a line
-- item has no server-mediated way to handle that -- they either fulfill
-- the whole order regardless, contact the customer manually, or reject
-- the entire merchant_order (auto_refund_and_auto_cancel..., migration
-- 0058) even when only one line item is the problem.
--
-- This lets the customer pick, per cart item, what should happen if it
-- turns out to be unavailable -- remove just that item, let the merchant
-- substitute one of their own products at their discretion (like
-- grocery-delivery "find a good replacement"), or cancel the whole
-- order -- and gives the merchant a single, server-enforced action
-- (resolve_unavailable_order_item) to apply it, rather than leaving the
-- resolution (and whether the customer gets refunded) to the merchant's
-- own judgment.

create type unavailable_item_preference as enum ('remove', 'substitute', 'cancel_order');
create type order_item_status as enum ('active', 'removed', 'substituted');

alter table order_items
  add column on_unavailable unavailable_item_preference not null default 'remove',
  add column item_status order_item_status not null default 'active',
  add column resolution_note text;

-- cancel_order doesn't need any new machinery here: it's applied by the
-- merchant rejecting/cancelling the whole merchant_order, which already
-- releases stock and refunds via order-status/index.ts +
-- refund_merchant_order_if_paid (migration 0058). Only stored so the
-- checkout UI and merchant Order Detail can show the customer's choice.

-- Distinguishes a whole-order synthetic return (existing behavior) from
-- a single-item one created below, so the two refund paths can never
-- double-refund or shadow one another.
alter table returns add column order_item_id uuid references order_items(id) on delete set null;

-- create_order(): now also reads each item's `on_unavailable` preference
-- (defaulting to 'remove' for any caller that doesn't send one -- e.g.
-- the checkout edge function will start sending it, but the RPC itself
-- must stay backward compatible). No other change: availability is still
-- resolved entirely at reservation time, same as before.
create or replace function create_order(
  p_customer_id uuid, p_address_id uuid, p_items jsonb, p_code text default null, p_scheduled_for timestamptz default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_order_id uuid;
  v_item jsonb;
  v_merchant_id uuid;
  v_category_id uuid;
  v_variant record;
  v_merchant_line_subtotal numeric;
  v_customer_line_subtotal numeric;
  v_order_subtotal numeric := 0;
  v_merchant_order_id uuid;
  v_rate numeric;
  v_commission numeric;
  v_merchant_ids uuid[] := '{}';
  v_category_ids uuid[] := '{}';
  v_product_ids uuid[] := '{}';
  v_discount discount_rules;
  v_discount_amount numeric := 0;
  v_mo record;
  v_mo_share numeric;
  v_mo_discount numeric;
  v_mo_tolo_share numeric;
  v_mo_merchant_share numeric;
  v_maintenance boolean;
  v_customer_status account_status;
  v_delivery_fee numeric := 0;
  v_address record;
  v_delivery_settings jsonb;
  v_delivery_enabled boolean;
  v_max_distance_km numeric;
  v_min_order_value numeric;
  v_store record;
  v_store_row stores%rowtype;
  v_distance_km numeric;
  v_scheduled_orders_enabled boolean;
  v_scheduled_settings jsonb;
  v_min_lead_minutes numeric;
  v_max_advance_days numeric;
begin
  select coalesce((value #>> '{}')::boolean, false) into v_maintenance
  from system_settings where key = 'platform_maintenance_mode';
  if v_maintenance and not is_tolo_staff() then
    raise exception 'Tolo is temporarily under maintenance. Please try again shortly.';
  end if;

  if p_customer_id <> auth.uid() and not is_tolo_staff() then
    raise exception 'Not authorized to create order for another customer';
  end if;

  select account_status into v_customer_status from profiles where id = p_customer_id;
  if v_customer_status = 'suspended' then
    raise exception 'This account is suspended and cannot place new orders.';
  end if;

  if p_scheduled_for is not null then
    select coalesce((value ->> 'scheduled_orders_enabled')::boolean, false) into v_scheduled_orders_enabled
    from system_settings where key = 'customer_features';
    if not v_scheduled_orders_enabled then
      raise exception 'Scheduled orders are not currently available.';
    end if;

    select value into v_scheduled_settings from system_settings where key = 'scheduled_orders';
    v_min_lead_minutes := coalesce((v_scheduled_settings->>'min_lead_minutes')::numeric, 60);
    v_max_advance_days := coalesce((v_scheduled_settings->>'max_advance_days')::numeric, 7);

    if p_scheduled_for < now() + (v_min_lead_minutes || ' minutes')::interval then
      raise exception 'Please choose a delivery time at least % minutes from now.', v_min_lead_minutes;
    end if;
    if p_scheduled_for > now() + (v_max_advance_days || ' days')::interval then
      raise exception 'Please choose a delivery time within the next % days.', v_max_advance_days;
    end if;
  end if;

  select latitude, longitude into v_address from addresses where id = p_address_id;

  select value into v_delivery_settings from system_settings where key = 'delivery';
  v_delivery_enabled := coalesce((v_delivery_settings->>'enabled')::boolean, true);
  v_max_distance_km := nullif(v_delivery_settings->>'max_delivery_distance_km', '')::numeric;

  select (value #>> '{}')::numeric into v_min_order_value
  from system_settings where key = 'min_order_value';
  v_min_order_value := coalesce(v_min_order_value, 0);

  insert into orders (customer_id, address_id, scheduled_for) values (p_customer_id, p_address_id, p_scheduled_for)
  returning id into v_order_id;

  for v_merchant_id in
    select distinct p.merchant_id
    from jsonb_array_elements(p_items) as item
    join product_variants pv on pv.id = (item->>'variant_id')::uuid
    join products p on p.id = pv.product_id
  loop
    if not exists (select 1 from merchants where id = v_merchant_id and status in ('active', 'approved')) then
      raise exception 'This store is not currently available for orders.';
    end if;

    select * into v_store_row from stores where merchant_id = v_merchant_id;
    if found and not store_is_open_now(v_store_row) then
      raise exception 'This store is currently closed for new orders.';
    end if;

    if v_max_distance_km is not null and v_address.latitude is not null and v_address.longitude is not null then
      select latitude, longitude into v_store from stores where merchant_id = v_merchant_id;
      if v_store.latitude is not null and v_store.longitude is not null then
        v_distance_km := haversine_km(v_store.latitude, v_store.longitude, v_address.latitude, v_address.longitude);
        if v_distance_km > v_max_distance_km then
          raise exception 'Your delivery address is too far from one of the stores in your cart for delivery.';
        end if;
      end if;
    end if;

    v_merchant_ids := array_append(v_merchant_ids, v_merchant_id);
    v_merchant_line_subtotal := 0;
    v_customer_line_subtotal := 0;

    select p.category_id into v_category_id
    from jsonb_array_elements(p_items) as item
    join product_variants pv on pv.id = (item->>'variant_id')::uuid
    join products p on p.id = pv.product_id
    where p.merchant_id = v_merchant_id
    limit 1;

    if v_category_id is not null then
      v_category_ids := array_append(v_category_ids, v_category_id);
    end if;

    v_rate := get_commission_rate(v_merchant_id, v_category_id);

    insert into merchant_orders (order_id, merchant_id, commission_rate_applied, scheduled_for)
    values (v_order_id, v_merchant_id, v_rate, p_scheduled_for)
    returning id into v_merchant_order_id;

    insert into order_status_history (merchant_order_id, status, note)
    values (v_merchant_order_id, 'new', 'Order created');

    for v_item in
      select item from jsonb_array_elements(p_items) as item
      join product_variants pv on pv.id = (item->>'variant_id')::uuid
      join products p on p.id = pv.product_id
      where p.merchant_id = v_merchant_id
    loop
      select pv.id as variant_id, pv.price, pv.discount_price, pv.attributes,
             p.id as product_id, p.name as product_name, p.status as product_status
      into v_variant
      from product_variants pv join products p on p.id = pv.product_id
      where pv.id = (v_item->>'variant_id')::uuid;

      if v_variant.product_status <> 'published' then
        raise exception 'This product is no longer available: %', v_variant.product_name;
      end if;

      v_product_ids := array_append(v_product_ids, v_variant.product_id);

      declare
        v_qty int := (v_item->>'quantity')::int;
        v_on_unavailable unavailable_item_preference := coalesce((v_item->>'on_unavailable')::unavailable_item_preference, 'remove');
        v_merchant_unit_price numeric := coalesce(v_variant.discount_price, v_variant.price);
        v_customer_unit_price numeric := round(coalesce(v_variant.discount_price, v_variant.price) * (1 + v_rate / 100), 2);
        v_merchant_subtotal numeric;
        v_customer_subtotal numeric;
      begin
        if v_qty <= 0 then
          raise exception 'Invalid quantity for variant %', v_variant.variant_id;
        end if;

        v_merchant_subtotal := v_qty * v_merchant_unit_price;
        v_customer_subtotal := v_qty * v_customer_unit_price;

        insert into order_items (
          merchant_order_id, variant_id, product_name_snapshot,
          variant_attributes_snapshot, unit_price, quantity, subtotal,
          merchant_unit_price, merchant_subtotal, on_unavailable
        ) values (
          v_merchant_order_id, v_variant.variant_id, v_variant.product_name,
          v_variant.attributes, v_customer_unit_price, v_qty, v_customer_subtotal,
          v_merchant_unit_price, v_merchant_subtotal, v_on_unavailable
        );

        perform reserve_stock(v_variant.variant_id, v_qty, v_order_id);

        v_merchant_line_subtotal := v_merchant_line_subtotal + v_merchant_subtotal;
        v_customer_line_subtotal := v_customer_line_subtotal + v_customer_subtotal;
      end;
    end loop;

    v_commission := v_customer_line_subtotal - v_merchant_line_subtotal;

    update merchant_orders
    set subtotal = v_customer_line_subtotal,
        merchant_subtotal = v_merchant_line_subtotal,
        commission_amount = v_commission,
        merchant_payable = v_merchant_line_subtotal
    where id = v_merchant_order_id;

    v_order_subtotal := v_order_subtotal + v_customer_line_subtotal;
  end loop;

  if v_order_subtotal = 0 then
    raise exception 'Cannot create an order with no items';
  end if;

  if v_min_order_value > 0 and v_order_subtotal < v_min_order_value then
    raise exception 'Your order subtotal (% ETB) is below the minimum order value of % ETB.', v_order_subtotal, v_min_order_value;
  end if;

  v_discount := resolve_best_discount(p_customer_id, v_merchant_ids, v_category_ids, v_product_ids, v_order_subtotal, p_code);

  if v_discount.id is not null then
    if v_discount.discount_kind = 'percent' then
      v_discount_amount := v_order_subtotal * v_discount.amount / 100;
      if v_discount.max_discount_amount is not null then
        v_discount_amount := least(v_discount_amount, v_discount.max_discount_amount);
      end if;
    else
      v_discount_amount := least(v_discount.amount, v_order_subtotal);
    end if;

    for v_mo in select * from merchant_orders where order_id = v_order_id loop
      v_mo_share := v_mo.subtotal / v_order_subtotal;
      v_mo_discount := round(v_discount_amount * v_mo_share, 2);

      if v_discount.funded_by = 'tolo' then
        v_mo_tolo_share := v_mo_discount;
        v_mo_merchant_share := 0;
      elsif v_discount.funded_by = 'merchant' then
        v_mo_tolo_share := 0;
        v_mo_merchant_share := v_mo_discount;
      else
        v_mo_tolo_share := round(v_mo_discount * v_discount.tolo_share_percent / 100, 2);
        v_mo_merchant_share := v_mo_discount - v_mo_tolo_share;
      end if;

      update merchant_orders
      set discount_amount = v_mo_discount,
          commission_amount = commission_amount - v_mo_tolo_share,
          merchant_payable = merchant_payable - v_mo_merchant_share
      where id = v_mo.id;
    end loop;

    insert into discount_redemptions (discount_rule_id, order_id, customer_id, discount_amount)
    values (v_discount.id, v_order_id, p_customer_id, v_discount_amount);

    update discount_rules set usage_count = usage_count + 1 where id = v_discount.id;
  end if;

  if v_delivery_enabled then
    v_delivery_fee := resolve_delivery_fee(v_address.latitude, v_address.longitude, v_order_subtotal - v_discount_amount);
  else
    v_delivery_fee := 0;
  end if;

  update orders
  set subtotal = v_order_subtotal,
      discount_amount = v_discount_amount,
      discount_rule_id = v_discount.id,
      delivery_fee = v_delivery_fee,
      total = v_order_subtotal - v_discount_amount + v_delivery_fee
  where id = v_order_id;

  return v_order_id;
end;
$$;

revoke execute on function create_order(uuid, uuid, jsonb, text, timestamptz) from public, anon, authenticated;

-- refund_merchant_order_if_paid: an item-level refund (below) now also
-- inserts a `returns` row for this merchant_order_id -- exclude those
-- from this function's own idempotency check, or a single item removal
-- would permanently block ever refunding the rest of the merchant_order
-- if it's later rejected/cancelled outright.
create or replace function refund_merchant_order_if_paid(p_merchant_order_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_order_id uuid;
  v_customer_id uuid;
  v_payment_status order_payment_status;
  v_subtotal numeric;
  v_discount_amount numeric;
  v_refund_amount numeric;
  v_already_refunded int;
  v_return_id uuid;
begin
  select mo.order_id, mo.subtotal, coalesce(mo.discount_amount, 0), o.customer_id, o.payment_status
  into v_order_id, v_subtotal, v_discount_amount, v_customer_id, v_payment_status
  from merchant_orders mo
  join orders o on o.id = mo.order_id
  where mo.id = p_merchant_order_id;

  if not found or v_payment_status <> 'paid' then
    return;
  end if;

  select count(*) into v_already_refunded
  from refunds f join returns r on r.id = f.return_id
  where r.merchant_order_id = p_merchant_order_id and r.order_item_id is null;
  if v_already_refunded > 0 then
    return;
  end if;

  v_refund_amount := greatest(v_subtotal - v_discount_amount, 0);
  if v_refund_amount <= 0 then
    return;
  end if;

  insert into returns (merchant_order_id, customer_id, reason, status)
  values (p_merchant_order_id, v_customer_id, p_reason, 'approved')
  returning id into v_return_id;

  insert into refunds (return_id, amount, status)
  values (v_return_id, v_refund_amount, 'pending');
end;
$$;

revoke execute on function refund_merchant_order_if_paid(uuid, text) from public, anon, authenticated;

insert into notification_templates (event_type, title_template, body_template) values
  ('order_item_removed', 'An item was removed from your order',
   '{{product_name}} was removed from order {{order_number}} because {{merchant_name}} could not fulfill it. {{refund_note}}'),
  ('order_item_substituted', 'An item was substituted in your order',
   '{{product_name}} in order {{order_number}} was substituted with {{new_product_name}} because {{merchant_name}} could not fulfill the original item.')
on conflict (event_type, channel, language) do nothing;

-- The single server-enforced action a merchant takes when they discover
-- they can't actually fulfill a specific line item. Applies exactly the
-- preference the customer chose at checkout (on_unavailable) -- the
-- merchant doesn't get to unilaterally decide whether the customer is
-- refunded. 'cancel_order' is deliberately NOT handled here: it's the
-- existing whole-merchant_order reject/cancel transition
-- (order-status/index.ts), which already releases every item's stock and
-- refunds the whole merchant_order -- reimplementing that here would
-- duplicate refund_merchant_order_if_paid's logic under a second code
-- path.
--
-- 'remove': releases the item's reserved stock, zeroes it out of the
-- merchant_order/order totals, and opens a refund for its own subtotal
-- if the order was already paid. Does not re-prorate the order-level
-- discount onto the removed item (same simplification this schema
-- already makes for delivery_fee on a full cancel, migration 0058) --
-- left to a manual financial_adjustments entry if a specific case needs
-- it.
--
-- 'substitute': the merchant reserves stock on a replacement variant of
-- their own (product_variants -> products.merchant_id must match) and
-- the item's price is recomputed at that variant's price using the
-- SAME commission rate already locked in for this merchant_order. If the
-- replacement is cheaper, the difference is refunded automatically
-- (safe to automate: it only ever gives money back). If it's pricier, no
-- extra charge is collected -- this schema has never automated charging
-- a customer additional money after checkout (see _shared/payment_providers.ts),
-- so that stays a manual admin case, same as every other "customer owes
-- more" scenario here.
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

  if not is_merchant_member(v_mo.merchant_id) and not is_tolo_staff() then
    raise exception 'Not authorized to modify this order';
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

-- Moves stock and money, exactly like release_stock/reserve_stock/
-- refund_merchant_order_if_paid -- called only via the resolve-order-item
-- Edge Function (service role), which does the real authorization check
-- in TypeScript, same as every other function in this group.
revoke execute on function resolve_unavailable_order_item(uuid, text, uuid, text) from public, anon, authenticated;
