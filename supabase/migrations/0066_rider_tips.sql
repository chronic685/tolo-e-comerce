-- Group 4, item 16: "Rider tips at checkout, recorded separately from
-- order total." A tip is for the delivery rider, not the merchant or
-- Tolo -- it must never flow into orders.total (which drives
-- merchant_orders.subtotal/commission/merchant_payable via create_order's
-- own per-merchant split) or be visible to the merchant as though it were
-- part of what they're owed. It's its own column, collected alongside the
-- order (COD: handed over with the rest; card/bank/mobile money: part of
-- the same payments row, same "not automated" treatment every other
-- payment provider already gets in this schema -- see
-- _shared/payment_providers.ts) but never merged into order/merchant
-- financials.
--
-- No rider-payout mechanism exists yet (Tolo Transport job creation is
-- explicitly out of scope for this group) -- this only captures and
-- surfaces the amount for now, same honest scope-limiting this schema
-- already applies to e.g. delivery_fee reconsideration on cancellation.

alter table orders add column rider_tip numeric(12,2) not null default 0 check (rider_tip >= 0);

-- Adding a parameter changes create_order's type signature -- same
-- drop-before-redefine convention every previous signature change here
-- has followed (0046, 0048), so the old signature doesn't linger as a
-- second, separately-privileged overload.
drop function if exists create_order(uuid, uuid, jsonb, text, timestamptz);

create or replace function create_order(
  p_customer_id uuid, p_address_id uuid, p_items jsonb, p_code text default null, p_scheduled_for timestamptz default null,
  p_rider_tip numeric default 0
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
  if coalesce(p_rider_tip, 0) < 0 then
    raise exception 'Rider tip cannot be negative';
  end if;

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

  insert into orders (customer_id, address_id, scheduled_for, rider_tip)
  values (p_customer_id, p_address_id, p_scheduled_for, coalesce(p_rider_tip, 0))
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

revoke execute on function create_order(uuid, uuid, jsonb, text, timestamptz, numeric) from public, anon, authenticated;
