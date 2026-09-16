-- Resolves commission rate: merchant-specific > category > platform > fallback.
create or replace function get_commission_rate(p_merchant_id uuid, p_category_id uuid)
returns numeric
language plpgsql stable security definer set search_path = public
as $$
declare
  v_rate numeric;
begin
  select rate_percent into v_rate from commission_rules
  where scope_type = 'merchant' and scope_id = p_merchant_id and is_active
  limit 1;
  if v_rate is not null then return v_rate; end if;

  if p_category_id is not null then
    select rate_percent into v_rate from commission_rules
    where scope_type = 'category' and scope_id = p_category_id and is_active
    limit 1;
    if v_rate is not null then return v_rate; end if;
  end if;

  select rate_percent into v_rate from commission_rules
  where scope_type = 'platform' and is_active
  limit 1;
  if v_rate is not null then return v_rate; end if;

  select (value #>> '{}')::numeric into v_rate from system_settings
  where key = 'default_commission_rate_percent';

  return coalesce(v_rate, 10);
end;
$$;

-- Creates a master order + per-merchant merchant_orders + order_items, and
-- reserves stock for every line, all inside one transaction (atomic: any
-- failure, including insufficient stock, rolls back the entire checkout).
create or replace function create_order(p_customer_id uuid, p_address_id uuid, p_items jsonb)
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
  v_line_subtotal numeric;
  v_order_subtotal numeric := 0;
  v_merchant_order_id uuid;
  v_rate numeric;
  v_commission numeric;
begin
  if p_customer_id <> auth.uid() and not is_tolo_staff() then
    raise exception 'Not authorized to create order for another customer';
  end if;

  insert into orders (customer_id, address_id) values (p_customer_id, p_address_id)
  returning id into v_order_id;

  -- One merchant_orders row per distinct merchant present in the cart.
  for v_merchant_id in
    select distinct p.merchant_id
    from jsonb_array_elements(p_items) as item
    join product_variants pv on pv.id = (item->>'variant_id')::uuid
    join products p on p.id = pv.product_id
  loop
    v_line_subtotal := 0;

    -- Pick any category_id from this merchant's lines to resolve the commission rate.
    select p.category_id into v_category_id
    from jsonb_array_elements(p_items) as item
    join product_variants pv on pv.id = (item->>'variant_id')::uuid
    join products p on p.id = pv.product_id
    where p.merchant_id = v_merchant_id
    limit 1;

    v_rate := get_commission_rate(v_merchant_id, v_category_id);

    insert into merchant_orders (order_id, merchant_id, commission_rate_applied)
    values (v_order_id, v_merchant_id, v_rate)
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
             p.name as product_name
      into v_variant
      from product_variants pv join products p on p.id = pv.product_id
      where pv.id = (v_item->>'variant_id')::uuid;

      declare
        v_qty int := (v_item->>'quantity')::int;
        v_unit_price numeric := coalesce(v_variant.discount_price, v_variant.price);
        v_subtotal numeric := v_qty * coalesce(v_variant.discount_price, v_variant.price);
      begin
        if v_qty <= 0 then
          raise exception 'Invalid quantity for variant %', v_variant.variant_id;
        end if;

        insert into order_items (
          merchant_order_id, variant_id, product_name_snapshot,
          variant_attributes_snapshot, unit_price, quantity, subtotal
        ) values (
          v_merchant_order_id, v_variant.variant_id, v_variant.product_name,
          v_variant.attributes, v_unit_price, v_qty, v_subtotal
        );

        perform reserve_stock(v_variant.variant_id, v_qty, v_order_id);

        v_line_subtotal := v_line_subtotal + v_subtotal;
      end;
    end loop;

    v_commission := round(v_line_subtotal * v_rate / 100, 2);

    update merchant_orders
    set subtotal = v_line_subtotal,
        commission_amount = v_commission,
        merchant_payable = v_line_subtotal - v_commission
    where id = v_merchant_order_id;

    v_order_subtotal := v_order_subtotal + v_line_subtotal;
  end loop;

  if v_order_subtotal = 0 then
    raise exception 'Cannot create an order with no items';
  end if;

  update orders set subtotal = v_order_subtotal, total = v_order_subtotal + delivery_fee
  where id = v_order_id;

  return v_order_id;
end;
$$;
