-- Demo/mock data for local development and manual testing.
-- Merchant owner: merchant-demo@tolo.test / Customer: customer-demo@tolo.test
-- (auth users created out-of-band via the Admin API; this migration only
-- seeds the rows that depend on their ids.)

insert into categories (name, slug) values
  ('Electronics', 'electronics'),
  ('Fashion', 'fashion'),
  ('Home & Living', 'home-living'),
  ('Beauty & Health', 'beauty-health'),
  ('Groceries', 'groceries')
on conflict (slug) do nothing;

do $$
declare
  v_merchant_user uuid := '4438aaed-b458-47dc-8b82-5fd688be8a4c';
  v_customer_user uuid := '20fed334-509f-4165-a69b-f7e0cc04cb41';
  v_merchant_id uuid;
  v_store_id uuid;
  v_category_id uuid;
  v_product1_id uuid;
  v_product2_id uuid;
  v_product3_id uuid;
  v_variant1_id uuid;
  v_variant2_id uuid;
  v_variant3a_id uuid;
  v_variant3b_id uuid;
  v_address_id uuid;
  v_order_id uuid;
  v_merchant_order_id uuid;
  v_payment_id uuid;
begin
  -- The demo auth users only exist in the original project. On a fresh
  -- database (local dev, CI) there's nothing to attach this data to, so skip
  -- it rather than fail every later migration.
  if not exists (select 1 from auth.users where id = v_merchant_user)
     or not exists (select 1 from auth.users where id = v_customer_user) then
    raise notice '0018_mock_data: demo users not present, skipping demo data';
    return;
  end if;

  select id into v_category_id from categories where slug = 'electronics';

  -- Merchant + store
  insert into merchants (owner_id, business_name, business_category, phone, email, location, status, agreement_accepted, approved_at)
  values (v_merchant_user, 'Habesha Electronics', 'Electronics', '+251911000000', 'merchant-demo@tolo.test', 'Addis Ababa', 'active', true, now())
  returning id into v_merchant_id;

  insert into merchant_staff (merchant_id, user_id, role)
  values (v_merchant_id, v_merchant_user, 'owner');

  insert into stores (merchant_id, name, slug, description, status)
  values (v_merchant_id, 'Habesha Electronics Store', 'habesha-electronics', 'Quality electronics and accessories.', 'active')
  returning id into v_store_id;

  insert into store_settings (store_id, auto_publish_products)
  values (v_store_id, true);

  -- Products
  insert into products (merchant_id, store_id, category_id, name, slug, description, base_price, sku, status)
  values (v_merchant_id, v_store_id, v_category_id, 'Wireless Earbuds', 'wireless-earbuds', 'Bluetooth 5.3 earbuds with charging case.', 1499.00, 'WEB-001', 'published')
  returning id into v_product1_id;

  insert into products (merchant_id, store_id, category_id, name, slug, description, base_price, sku, status)
  values (v_merchant_id, v_store_id, v_category_id, 'Power Bank 20000mAh', 'power-bank-20000', 'Fast-charging portable power bank.', 1899.00, 'PB-020', 'published')
  returning id into v_product2_id;

  insert into products (merchant_id, store_id, category_id, name, slug, description, base_price, sku, status)
  values (v_merchant_id, v_store_id, v_category_id, 'Phone Case', 'phone-case', 'Shockproof phone case, multiple colors.', 349.00, 'PC-010', 'published')
  returning id into v_product3_id;

  -- Variants (default variant per simple product; two color variants for the phone case)
  insert into product_variants (product_id, sku, attributes, price, is_default)
  values (v_product1_id, 'WEB-001-DEF', '{}'::jsonb, 1499.00, true)
  returning id into v_variant1_id;

  insert into product_variants (product_id, sku, attributes, price, is_default)
  values (v_product2_id, 'PB-020-DEF', '{}'::jsonb, 1899.00, true)
  returning id into v_variant2_id;

  insert into product_variants (product_id, sku, attributes, price, is_default)
  values (v_product3_id, 'PC-010-BLK', '{"color":"Black"}'::jsonb, 349.00, true)
  returning id into v_variant3a_id;

  insert into product_variants (product_id, sku, attributes, price, is_default)
  values (v_product3_id, 'PC-010-BLU', '{"color":"Blue"}'::jsonb, 349.00, false)
  returning id into v_variant3b_id;

  insert into product_images (product_id, variant_id, url, sort_order, is_primary) values
    (v_product1_id, null, 'https://placehold.co/600x600?text=Wireless+Earbuds', 0, true),
    (v_product2_id, null, 'https://placehold.co/600x600?text=Power+Bank', 0, true),
    (v_product3_id, v_variant3a_id, 'https://placehold.co/600x600?text=Phone+Case+Black', 0, true),
    (v_product3_id, v_variant3b_id, 'https://placehold.co/600x600?text=Phone+Case+Blue', 1, false);

  -- Inventory
  insert into inventory (variant_id, stock_quantity, low_stock_threshold) values
    (v_variant1_id, 50, 5),
    (v_variant2_id, 30, 5),
    (v_variant3a_id, 100, 10),
    (v_variant3b_id, 80, 10);

  -- Customer address
  insert into addresses (customer_id, label, recipient_name, phone, line1, city, country, is_default)
  values (v_customer_user, 'Home', 'Demo Customer', '+251922000000', 'Bole Road, House 12', 'Addis Ababa', 'ET', true)
  returning id into v_address_id;

  -- One fully completed order, to exercise order splitting, payment, wallet ledger, and reviews.
  select create_order(v_customer_user, v_address_id, jsonb_build_array(
    jsonb_build_object('variant_id', v_variant1_id, 'quantity', 1),
    jsonb_build_object('variant_id', v_variant3a_id, 'quantity', 2)
  )) into v_order_id;

  select id into v_merchant_order_id from merchant_orders where order_id = v_order_id;

  insert into payments (order_id, provider, amount, status)
  select v_order_id, 'demo', total, 'verified' from orders where id = v_order_id
  returning id into v_payment_id;

  update orders set payment_status = 'paid' where id = v_order_id;

  -- Convert the reservation into a confirmed sale for each line.
  perform release_stock(oi.variant_id, oi.quantity, v_order_id, true)
  from order_items oi where oi.merchant_order_id = v_merchant_order_id;

  perform post_wallet_transaction(
    (select merchant_id from merchant_orders where id = v_merchant_order_id),
    v_merchant_order_id, 'sale',
    (select subtotal from merchant_orders where id = v_merchant_order_id),
    'Demo order payment confirmed'
  );

  perform post_wallet_transaction(
    (select merchant_id from merchant_orders where id = v_merchant_order_id),
    v_merchant_order_id, 'commission',
    -(select commission_amount from merchant_orders where id = v_merchant_order_id),
    'Demo platform commission'
  );

  update merchant_orders set status = 'completed' where id = v_merchant_order_id;

  insert into order_status_history (merchant_order_id, status, note) values
    (v_merchant_order_id, 'accepted', 'Demo: merchant accepted'),
    (v_merchant_order_id, 'processing', 'Demo: preparing order'),
    (v_merchant_order_id, 'ready_for_pickup', 'Demo: ready for pickup'),
    (v_merchant_order_id, 'picked_up', 'Demo: picked up by driver'),
    (v_merchant_order_id, 'delivered', 'Demo: delivered to customer'),
    (v_merchant_order_id, 'completed', 'Demo: order completed');

  insert into reviews (product_id, customer_id, merchant_order_id, rating, comment)
  values (v_product1_id, v_customer_user, v_merchant_order_id, 5, 'Great sound quality, fast delivery!');
end $$;
