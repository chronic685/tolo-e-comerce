-- Scheduled orders, wiring up the previously-dead
-- customer_features.scheduled_orders_enabled toggle (migration 0026). No
-- scheduling concept existed anywhere in this schema before this migration
-- (no scheduled_at/scheduled_for column, no picker) -- confirmed via a
-- repo-wide grep first, same as the last few features this session.
--
-- 1. Schema -----------------------------------------------------------
-- scheduled_for lives on orders, not merchant_orders: delivery timing is a
-- single choice the customer makes for their whole cart at checkout (one
-- picker in Checkout.tsx), not something split per merchant the way
-- fulfillment itself is (deliveries is one row per merchant_order,
-- migration 0010, because dispatch genuinely differs per merchant/store --
-- but nothing in this app lets a customer pick a different delivery time
-- per merchant in the same cart, and building that wasn't asked for).
--
-- merchant_orders ALSO gets its own copy, denormalized at creation time --
-- not because the data belongs there, but because orders_select RLS
-- (migration 0015) is "customer_id = auth.uid() or staff", which a
-- merchant is neither. Every other order-level number a merchant needs to
-- see (subtotal, commission_amount, merchant_payable) is already
-- denormalized onto merchant_orders for exactly this reason -- this
-- follows the same established pattern rather than widening orders_select
-- to a new role just to expose one timestamp.
alter table orders add column scheduled_for timestamptz;
alter table merchant_orders add column scheduled_for timestamptz;

create index idx_orders_scheduled_for on orders(scheduled_for) where scheduled_for is not null;

-- Bounds are business-tunable (same pattern as rate_limits/referral_reward)
-- rather than hardcoded -- editable later without a deploy, no dedicated
-- admin UI control added this round (same as those two today).
insert into system_settings (key, value) values
  ('scheduled_orders', jsonb_build_object('min_lead_minutes', 60, 'max_advance_days', 7))
on conflict (key) do nothing;

-- 2. create_order(): validate + persist the scheduled time -----------------
-- A null p_scheduled_for means "as soon as possible" and changes nothing
-- about today's behavior. A non-null value must be: after the master
-- toggle is actually on (checked here, not just left to Checkout.tsx --
-- same "frontend convenience, not a security boundary" reasoning already
-- applied to payment_provider in checkout/index.ts), strictly in the
-- future, at least min_lead_minutes out (a merchant needs real prep time --
-- "right now" isn't a meaningful distinction from an unscheduled order),
-- and no more than max_advance_days out (an unbounded window means stock/
-- pricing/commission-rate assumptions locked in today could be stale by
-- the time the order is actually fulfilled).
drop function if exists create_order(uuid, uuid, jsonb, text);

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

-- 3. escalate_unacknowledged_orders(): don't page Ops over a scheduled
-- order that simply hasn't reached its delivery window yet -------------
-- Previously: any 'new' order whose notification_sent_at was more than
-- escalate_after_minutes ago got escalated, full stop. finalizePaymentSuccess()
-- (payment_finalize.ts) still stamps notification_sent_at immediately at
-- payment time regardless of scheduling -- deferring that stamp to nearer
-- the delivery time would need a whole second cron/wake-up mechanism just
-- to "activate" a scheduled order later, which is more machinery than this
-- task's scope. Simpler fix: reuse escalate_after_minutes itself as the
-- "how close to the scheduled time before normal urgency applies" window --
-- no new setting needed. A scheduled order is exempt from escalation until
-- now() is within that many minutes of its scheduled_for; once inside that
-- window it gets exactly the same acknowledgment runway a same-day order
-- always had, and escalates on the same terms if still unacknowledged.
create or replace function escalate_unacknowledged_orders()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_threshold_minutes numeric;
  v_in_app_enabled boolean;
  v_claimed record;
  v_ops_user record;
  v_merchant_name text;
  v_waiting_minutes integer;
  v_count integer := 0;
begin
  select (value ->> 'escalate_after_minutes')::numeric into v_threshold_minutes
  from system_settings where key = 'merchant_new_order_alerts';

  if v_threshold_minutes is null or v_threshold_minutes <= 0 then
    return 0;
  end if;

  select coalesce((value ->> 'in_app')::boolean, true) into v_in_app_enabled
  from system_settings where key = 'notification_channels';

  for v_claimed in
    update merchant_orders
    set escalated_at = now()
    where status = 'new'
      and order_received_at is null
      and escalated_at is null
      and notification_sent_at is not null
      and notification_sent_at <= now() - (v_threshold_minutes || ' minutes')::interval
      and (scheduled_for is null or scheduled_for <= now() + (v_threshold_minutes || ' minutes')::interval)
    returning id, merchant_id, notification_sent_at
  loop
    v_count := v_count + 1;

    if v_in_app_enabled then
      begin
        select business_name into v_merchant_name from merchants where id = v_claimed.merchant_id;
        v_waiting_minutes := greatest(0, floor(extract(epoch from (now() - v_claimed.notification_sent_at)) / 60))::integer;

        for v_ops_user in
          select id from profiles where role in ('tolo_ops', 'tolo_admin') and account_status = 'active'
        loop
          insert into notifications (user_id, type, title, body)
          select
            v_ops_user.id,
            t.event_type,
            replace(t.title_template, '{{merchant_name}}', coalesce(v_merchant_name, 'a merchant')),
            replace(replace(replace(t.body_template,
              '{{order_id_short}}', left(v_claimed.id::text, 8)),
              '{{merchant_name}}', coalesce(v_merchant_name, 'a merchant')),
              '{{waiting_minutes}}', v_waiting_minutes::text)
          from notification_templates t
          where t.event_type = 'order_unacknowledged_escalated' and t.channel = 'in_app' and t.language = 'en' and t.enabled;
        end loop;
      exception when others then
        raise warning 'escalate_unacknowledged_orders: notification failed for merchant_order %: %', v_claimed.id, sqlerrm;
      end;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke execute on function escalate_unacknowledged_orders() from public, anon, authenticated;
