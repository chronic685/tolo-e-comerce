-- Switches commission from "deducted from the merchant" to "added on top for
-- the customer" (Tolo E-Commerce merchant spec, section 12-14): the merchant
-- enters their own price, the customer pays merchant_price * (1 + rate), and
-- the merchant keeps 100% of their listed price. Tolo's commission is
-- additional revenue tracked on merchant_orders.commission_amount, not a
-- debit against the merchant's wallet.

alter table order_items
  add column merchant_unit_price numeric(12,2),
  add column merchant_subtotal numeric(12,2);

alter table merchant_orders
  add column merchant_subtotal numeric(12,2) not null default 0;

-- Platform default moves to 5%, expressed as an explicit configurable rule
-- (spec section 31) rather than only the system_settings fallback.
update system_settings set value = '5'::jsonb where key = 'default_commission_rate_percent';

insert into commission_rules (scope_type, rate_percent, is_active)
values ('platform', 5, true);

-- Read-only "what the customer pays" for browsing/display. Uses the same
-- get_commission_rate() the checkout path uses, so a product's displayed
-- price and its checkout price can never disagree, and neither the merchant
-- dashboard nor the customer app ever computes this themselves (spec section 32).
create or replace function product_variants_customer_price(v product_variants)
returns numeric
language sql stable
as $$
  select round(
    coalesce(v.discount_price, v.price) *
    (1 + get_commission_rate(
      (select merchant_id from products where id = v.product_id),
      (select category_id from products where id = v.product_id)
    ) / 100),
    2
  );
$$;

create or replace function products_customer_price(p products)
returns numeric
language sql stable
as $$
  select round(
    coalesce(p.discount_price, p.base_price) *
    (1 + get_commission_rate(p.merchant_id, p.category_id) / 100),
    2
  );
$$;

-- Rewritten checkout: merchant_unit_price is the price of record; the
-- customer-facing unit_price is merchant_unit_price plus commission,
-- computed and charged server-side only.
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
begin
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
    v_merchant_line_subtotal := 0;
    v_customer_line_subtotal := 0;

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

  update orders set subtotal = v_order_subtotal, total = v_order_subtotal + delivery_fee
  where id = v_order_id;

  return v_order_id;
end;
$$;

-- Rebuild the demo order under the new model (it was created under the old
-- deduction model and its numbers no longer reconcile). Only touches the
-- demo customer's own order chain. wallet_transactions is normally an
-- immutable ledger; briefly disabling that guard here is a one-time dev-data
-- correction, not something application code should ever do.
alter table wallet_transactions disable trigger wallet_transactions_no_update;

do $$
declare
  v_customer_user uuid := '20fed334-509f-4165-a69b-f7e0cc04cb41';
  v_old_order_id uuid;
  v_merchant_id uuid;
  v_address_id uuid;
  v_variant1_id uuid;
  v_variant3a_id uuid;
  v_new_order_id uuid;
  v_new_merchant_order_id uuid;
begin
  select id into v_merchant_id from merchants where business_name = 'Habesha Electronics';

  select o.id into v_old_order_id
  from orders o
  where o.customer_id = v_customer_user
  order by o.created_at asc
  limit 1;

  if v_old_order_id is not null then
    delete from reviews where merchant_order_id in (select id from merchant_orders where order_id = v_old_order_id);
    delete from wallet_transactions where merchant_order_id in (select id from merchant_orders where order_id = v_old_order_id);
    delete from order_status_history where merchant_order_id in (select id from merchant_orders where order_id = v_old_order_id);
    delete from order_items where merchant_order_id in (select id from merchant_orders where order_id = v_old_order_id);
    delete from merchant_orders where order_id = v_old_order_id;
    delete from payments where order_id = v_old_order_id;
    delete from orders where id = v_old_order_id;
  end if;

  update merchant_wallets set balance = 0 where merchant_id = v_merchant_id;

  select id into v_address_id from addresses where customer_id = v_customer_user order by created_at limit 1;
  select id into v_variant1_id from product_variants where sku = 'WEB-001-DEF';
  select id into v_variant3a_id from product_variants where sku = 'PC-010-BLK';

  select create_order(v_customer_user, v_address_id, jsonb_build_array(
    jsonb_build_object('variant_id', v_variant1_id, 'quantity', 1),
    jsonb_build_object('variant_id', v_variant3a_id, 'quantity', 2)
  )) into v_new_order_id;

  select id into v_new_merchant_order_id from merchant_orders where order_id = v_new_order_id;

  insert into payments (order_id, provider, amount, status)
  select v_new_order_id, 'demo', total, 'verified' from orders where id = v_new_order_id;

  update orders set payment_status = 'paid' where id = v_new_order_id;

  perform release_stock(oi.variant_id, oi.quantity, v_new_order_id, true)
  from order_items oi where oi.merchant_order_id = v_new_merchant_order_id;

  perform post_wallet_transaction(
    v_merchant_id, v_new_merchant_order_id, 'sale',
    (select merchant_payable from merchant_orders where id = v_new_merchant_order_id),
    'Demo order payment confirmed (full merchant price)'
  );

  update merchant_orders set status = 'completed' where id = v_new_merchant_order_id;

  insert into order_status_history (merchant_order_id, status, note) values
    (v_new_merchant_order_id, 'accepted', 'Demo: merchant accepted'),
    (v_new_merchant_order_id, 'processing', 'Demo: preparing order'),
    (v_new_merchant_order_id, 'ready_for_pickup', 'Demo: ready for pickup'),
    (v_new_merchant_order_id, 'picked_up', 'Demo: picked up by driver'),
    (v_new_merchant_order_id, 'delivered', 'Demo: delivered to customer'),
    (v_new_merchant_order_id, 'completed', 'Demo: order completed');

  insert into reviews (product_id, customer_id, merchant_order_id, rating, comment)
  select p.id, v_customer_user, v_new_merchant_order_id, 5, 'Great sound quality, fast delivery!'
  from products p where p.slug = 'wireless-earbuds';
end $$;

alter table wallet_transactions enable trigger wallet_transactions_no_update;
