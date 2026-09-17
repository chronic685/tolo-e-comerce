-- Seeds the five discount examples from the admin spec (section 9), and adds
-- a few more admin-configurable on/off controls: a platform-wide maintenance
-- kill switch (enforced in checkout, not just a cosmetic toggle), plus
-- additional customer/merchant feature flags and notification channels.

-- 1. Discount rule examples --------------------------------------------

insert into discount_rules (name, description, scope_type, scope_id, discount_kind, amount, min_order_value, funded_by, first_order_only, per_customer_limit)
values (
  'First Order 10% Off',
  '10% off a customer''s first order on Tolo.',
  'platform', null, 'percent', 10, 0, 'tolo', true, 1
);

insert into discount_rules (name, description, scope_type, scope_id, discount_kind, amount, funded_by, tolo_share_percent)
values (
  'Habesha Electronics 20% Off',
  '20% off products from Habesha Electronics.',
  'merchant', 'cb2ea2ca-444f-4f5c-a13c-2e73e74a0cca', 'percent', 20, 'shared', 50
);

insert into discount_rules (name, description, scope_type, scope_id, discount_kind, amount, funded_by)
values (
  'Electronics Category 15% Off',
  '15% off everything in the Electronics category.',
  'category', '18e50e5d-1cd9-4054-a4f9-d677c28e8115', 'percent', 15, 'tolo'
);

insert into discount_rules (name, description, scope_type, scope_id, discount_kind, amount, min_order_value, funded_by)
values (
  'Big Order 25% Off',
  '25% off orders above 1,000 ETB, platform-wide.',
  'platform', null, 'percent', 25, 1000, 'tolo'
);

insert into discount_rules (name, description, scope_type, scope_id, discount_kind, amount, funded_by, usage_limit)
values (
  'Launch Campaign — 50 ETB Off',
  '50 ETB off for the first 500 customers, platform-wide.',
  'platform', null, 'fixed', 50, 'tolo', 500
);

-- All seeded inactive by default — an admin reviews and switches on the ones
-- they actually want live, rather than five live promotions appearing
-- unannounced. Toggle from the Discounts admin page.
update discount_rules set is_active = false
where name in (
  'First Order 10% Off', 'Habesha Electronics 20% Off', 'Electronics Category 15% Off',
  'Big Order 25% Off', 'Launch Campaign — 50 ETB Off'
);

-- 2. Platform maintenance mode — a real kill switch, enforced in checkout
-- (not just a cosmetic admin toggle), plus a few more feature flags.

insert into system_settings (key, value) values
  ('platform_maintenance_mode', 'false'::jsonb),
  ('notification_channels', '{"push": true, "sms": true, "email": true, "in_app": true}'::jsonb)
on conflict (key) do nothing;

update system_settings
set value = value || '{"favorites_enabled": true, "scheduled_orders_enabled": false, "order_cancellation_enabled": true, "promo_codes_enabled": true}'::jsonb
where key = 'customer_features';

update system_settings
set value = value || '{"staff_accounts_enabled": true, "multiple_branches_enabled": false, "settlement_requests_enabled": true}'::jsonb
where key = 'merchant_features';

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
  v_merchant_line_subtotal numeric;
  v_customer_line_subtotal numeric;
  v_order_subtotal numeric := 0;
  v_merchant_order_id uuid;
  v_rate numeric;
  v_commission numeric;
  v_merchant_ids uuid[] := '{}';
  v_category_ids uuid[] := '{}';
  v_discount discount_rules;
  v_discount_amount numeric := 0;
  v_mo record;
  v_mo_share numeric;
  v_mo_discount numeric;
  v_mo_tolo_share numeric;
  v_mo_merchant_share numeric;
  v_maintenance boolean;
begin
  select coalesce((value #>> '{}')::boolean, false) into v_maintenance
  from system_settings where key = 'platform_maintenance_mode';
  if v_maintenance and not is_tolo_staff() then
    raise exception 'Tolo is temporarily under maintenance. Please try again shortly.';
  end if;

  if p_customer_id <> auth.uid() and not is_tolo_staff() then
    raise exception 'Not authorized to create order for another customer';
  end if;

  insert into orders (customer_id, address_id) values (p_customer_id, p_address_id)
  returning id into v_order_id;

  for v_merchant_id in
    select distinct p.merchant_id
    from jsonb_array_elements(p_items) as item
    join product_variants pv on pv.id = (item->>'variant_id')::uuid
    join products p on p.id = pv.product_id
  loop
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
          merchant_unit_price, merchant_subtotal
        ) values (
          v_merchant_order_id, v_variant.variant_id, v_variant.product_name,
          v_variant.attributes, v_customer_unit_price, v_qty, v_customer_subtotal,
          v_merchant_unit_price, v_merchant_subtotal
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

  v_discount := resolve_best_discount(p_customer_id, v_merchant_ids, v_category_ids, v_order_subtotal);

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

  update orders
  set subtotal = v_order_subtotal,
      discount_amount = v_discount_amount,
      discount_rule_id = v_discount.id,
      total = v_order_subtotal - v_discount_amount + delivery_fee
  where id = v_order_id;

  return v_order_id;
end;
$$;
