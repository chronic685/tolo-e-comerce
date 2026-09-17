-- Closes the genuinely-missing pieces identified against the Database &
-- Data Model spec (additive only — no renaming of the live schema). Note:
-- inventory_transactions from that spec already exists here as
-- inventory_movements (0005_inventory.sql), just under a different name —
-- nothing to add there beyond an admin viewer.

-- 1. Delivery zones — geographic coverage + per-zone pricing --------------
-- Simplified vs. the spec's PostGIS/polygon boundary: a center point +
-- radius, since PostGIS isn't confirmed enabled on this project and a
-- circle covers the same "which zone is this delivery in" need without it.
-- delivery_fee_rules (distance-banded pricing) is folded into the zone row
-- itself rather than a separate table, since nothing here needs more than
-- one fee per zone yet.

create table delivery_zones (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  center_latitude numeric(9,6) not null,
  center_longitude numeric(9,6) not null,
  radius_km numeric(6,2) not null check (radius_km > 0),
  delivery_fee numeric(12,2) not null default 0,
  free_delivery_threshold numeric(12,2),
  max_distance_km numeric(6,2),
  estimated_delivery_minutes int,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger delivery_zones_set_updated_at
  before update on delivery_zones
  for each row execute function set_updated_at();

create trigger delivery_zones_log_change
  after insert or update on delivery_zones
  for each row execute function log_config_change();

create or replace function is_tolo_ops_or_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and account_status = 'active' and role in ('tolo_ops', 'tolo_admin')
  );
$$;

alter table delivery_zones enable row level security;

create policy "delivery_zones_select" on delivery_zones
  for select using (true);

create policy "delivery_zones_manage" on delivery_zones
  for all using (is_tolo_ops_or_admin()) with check (is_tolo_ops_or_admin());

create or replace function haversine_km(lat1 numeric, lon1 numeric, lat2 numeric, lon2 numeric)
returns numeric
language sql immutable
as $$
  select 6371 * acos(
    least(1, greatest(-1,
      cos(radians(lat1)) * cos(radians(lat2)) * cos(radians(lon2) - radians(lon1)) +
      sin(radians(lat1)) * sin(radians(lat2))
    ))
  );
$$;

-- Nearest active zone that actually contains the point (distance <= its own
-- radius) wins; otherwise fall back to the flat platform default. Either
-- way, a free-delivery threshold zeroes the fee once the order qualifies.
create or replace function resolve_delivery_fee(p_latitude numeric, p_longitude numeric, p_order_subtotal numeric)
returns numeric
language plpgsql stable security definer set search_path = public
as $$
declare
  v_zone delivery_zones;
  v_default_fee numeric;
  v_default_threshold numeric;
  v_delivery_settings jsonb;
begin
  if p_latitude is not null and p_longitude is not null then
    select z.* into v_zone
    from delivery_zones z
    where z.is_active
      and haversine_km(z.center_latitude, z.center_longitude, p_latitude, p_longitude) <= z.radius_km
    order by haversine_km(z.center_latitude, z.center_longitude, p_latitude, p_longitude) asc
    limit 1;

    if v_zone.id is not null then
      if v_zone.free_delivery_threshold is not null and p_order_subtotal >= v_zone.free_delivery_threshold then
        return 0;
      end if;
      return v_zone.delivery_fee;
    end if;
  end if;

  select value into v_delivery_settings from system_settings where key = 'delivery';
  v_default_fee := coalesce((v_delivery_settings->>'base_fee')::numeric, 0);
  v_default_threshold := (v_delivery_settings->>'free_delivery_threshold')::numeric;

  if v_default_threshold is not null and p_order_subtotal >= v_default_threshold then
    return 0;
  end if;
  return v_default_fee;
end;
$$;

-- 2. Commission effective dating (spec section 35) -------------------------

alter table commission_rules add column effective_from timestamptz;
alter table commission_rules add column effective_until timestamptz;

create or replace function get_commission_rate(p_merchant_id uuid, p_category_id uuid)
returns numeric
language plpgsql stable security definer set search_path = public
as $$
declare
  v_rate numeric;
begin
  select rate_percent into v_rate from commission_rules
  where scope_type = 'merchant' and scope_id = p_merchant_id and is_active
    and (effective_from is null or effective_from <= now())
    and (effective_until is null or effective_until >= now())
  limit 1;
  if v_rate is not null then return v_rate; end if;

  if p_category_id is not null then
    select rate_percent into v_rate from commission_rules
    where scope_type = 'category' and scope_id = p_category_id and is_active
      and (effective_from is null or effective_from <= now())
      and (effective_until is null or effective_until >= now())
    limit 1;
    if v_rate is not null then return v_rate; end if;
  end if;

  select rate_percent into v_rate from commission_rules
  where scope_type = 'platform' and is_active
    and (effective_from is null or effective_from <= now())
    and (effective_until is null or effective_until >= now())
  limit 1;
  if v_rate is not null then return v_rate; end if;

  select (value #>> '{}')::numeric into v_rate from system_settings
  where key = 'default_commission_rate_percent';

  return coalesce(v_rate, 10);
end;
$$;

-- 3. Notification templates (spec section 40) -------------------------------

create table notification_templates (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  channel text not null default 'in_app',
  language text not null default 'en',
  title_template text not null,
  body_template text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_type, channel, language)
);

create trigger notification_templates_set_updated_at
  before update on notification_templates
  for each row execute function set_updated_at();

create trigger notification_templates_log_change
  after insert or update on notification_templates
  for each row execute function log_config_change();

alter table notification_templates enable row level security;

create policy "notification_templates_select" on notification_templates
  for select using (true);

create policy "notification_templates_manage" on notification_templates
  for all using (is_tolo_admin() or is_tolo_marketing() or is_tolo_support())
  with check (is_tolo_admin() or is_tolo_marketing() or is_tolo_support());

insert into notification_templates (event_type, title_template, body_template) values
  ('order_new', 'New order received', 'Order #{{order_id_short}} — {{item_count}} item(s), {{amount}} ETB'),
  ('order_received', 'Order confirmed', '{{merchant_name}} has received your order #{{order_id_short}} and will start preparing it.'),
  ('order_preparing', 'Your order is being prepared', '{{merchant_name}} is preparing order #{{order_id_short}}.'),
  ('order_ready_for_pickup', 'Order ready for pickup', 'Order #{{order_id_short}} from {{merchant_name}} is ready and waiting for a driver.'),
  ('order_delivered', 'Order delivered', 'Order #{{order_id_short}} has been delivered. Enjoy!'),
  ('order_cancelled', 'Order cancelled', 'Order #{{order_id_short}} was cancelled.'),
  ('payment_success', 'Payment received', 'We''ve received your payment of {{amount}} ETB for order #{{order_id_short}}.'),
  ('payment_failed', 'Payment failed', 'Your payment for order #{{order_id_short}} could not be verified. Please try again.'),
  ('refund_issued', 'Refund issued', 'A refund of {{amount}} ETB has been issued to you.'),
  ('merchant_approved', 'You''re approved!', 'Congratulations — {{merchant_name}} is now approved to sell on Tolo.'),
  ('merchant_rejected', 'Application update', 'Your Tolo merchant application needs attention: {{reason}}'),
  ('promotion', '{{promotion_name}}', '{{promotion_description}}');

-- 4. Financial adjustments ledger (spec section 38) -------------------------

create table financial_adjustments (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id),
  order_id uuid references orders(id),
  settlement_id uuid references settlements(id),
  type text not null,
  amount numeric(12,2) not null,
  reason text not null,
  created_by uuid references profiles(id),
  approved_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index idx_financial_adjustments_merchant on financial_adjustments(merchant_id);

create trigger financial_adjustments_log_change
  after insert on financial_adjustments
  for each row execute function log_config_change();

alter table financial_adjustments enable row level security;

create policy "financial_adjustments_select" on financial_adjustments
  for select using (is_merchant_member(merchant_id) or is_tolo_finance());

create policy "financial_adjustments_manage" on financial_adjustments
  for all using (is_tolo_finance()) with check (is_tolo_finance());

-- 5. Customer favorites (spec section 50) -----------------------------------

create table customer_favorites (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,
  merchant_id uuid references merchants(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint favorites_exactly_one_target check (
    (product_id is not null and merchant_id is null) or (product_id is null and merchant_id is not null)
  )
);

create unique index idx_favorites_customer_product on customer_favorites(customer_id, product_id) where product_id is not null;
create unique index idx_favorites_customer_merchant on customer_favorites(customer_id, merchant_id) where merchant_id is not null;

alter table customer_favorites enable row level security;

create policy "customer_favorites_select" on customer_favorites
  for select using (customer_id = auth.uid() or is_tolo_staff());

create policy "customer_favorites_manage_own" on customer_favorites
  for all using (customer_id = auth.uid()) with check (customer_id = auth.uid());

-- 6. Multi-target discounts (spec section 35 / 18-discount-targeting) ------
-- Additive alongside discount_rules.scope_id (single-target): a rule with
-- rows here matches ANY of them, on top of whatever its own scope_id covers.

create table discount_targets (
  id uuid primary key default gen_random_uuid(),
  discount_id uuid not null references discount_rules(id) on delete cascade,
  target_type text not null check (target_type in ('merchant', 'category', 'product')),
  target_id uuid not null,
  created_at timestamptz not null default now(),
  unique (discount_id, target_type, target_id)
);

alter table discount_targets enable row level security;

create policy "discount_targets_select" on discount_targets
  for select using (true);

create policy "discount_targets_manage" on discount_targets
  for all using (is_tolo_marketing() or is_tolo_admin())
  with check (is_tolo_marketing() or is_tolo_admin());

-- Changing the parameter list would otherwise leave the old 4-arg version
-- behind as a separate overload instead of replacing it.
drop function if exists resolve_best_discount(uuid, uuid[], uuid[], numeric);

create or replace function resolve_best_discount(
  p_customer_id uuid,
  p_merchant_ids uuid[],
  p_category_ids uuid[],
  p_product_ids uuid[],
  p_order_subtotal numeric
)
returns discount_rules
language plpgsql stable security definer set search_path = public
as $$
declare
  v_enabled boolean;
  v_best discount_rules;
  v_candidate discount_rules;
  v_candidate_amount numeric;
  v_best_amount numeric := 0;
  v_is_first_order boolean;
begin
  select coalesce((value #>> '{}')::boolean, true) into v_enabled
  from system_settings where key = 'discounts_enabled';
  if v_enabled is false then
    return null;
  end if;

  select not exists (select 1 from orders where customer_id = p_customer_id)
  into v_is_first_order;

  for v_candidate in
    select * from discount_rules
    where is_active
      and (starts_at is null or starts_at <= now())
      and (ends_at is null or ends_at >= now())
      and min_order_value <= p_order_subtotal
      and (not first_order_only or v_is_first_order)
      and (usage_limit is null or usage_count < usage_limit)
      and (
        scope_type = 'platform'
        or (scope_type = 'merchant' and scope_id = any(p_merchant_ids))
        or (scope_type = 'category' and scope_id = any(p_category_ids))
        or (scope_type = 'product' and scope_id = any(p_product_ids))
        or exists (
          select 1 from discount_targets dt
          where dt.discount_id = discount_rules.id
            and (
              (dt.target_type = 'merchant' and dt.target_id = any(p_merchant_ids))
              or (dt.target_type = 'category' and dt.target_id = any(p_category_ids))
              or (dt.target_type = 'product' and dt.target_id = any(p_product_ids))
            )
        )
      )
  loop
    if v_candidate.per_customer_limit is not null then
      if (
        select count(*) from discount_redemptions
        where discount_rule_id = v_candidate.id and customer_id = p_customer_id
      ) >= v_candidate.per_customer_limit then
        continue;
      end if;
    end if;

    if v_candidate.discount_kind = 'percent' then
      v_candidate_amount := p_order_subtotal * v_candidate.amount / 100;
      if v_candidate.max_discount_amount is not null then
        v_candidate_amount := least(v_candidate_amount, v_candidate.max_discount_amount);
      end if;
    else
      v_candidate_amount := least(v_candidate.amount, p_order_subtotal);
    end if;

    if v_candidate_amount > v_best_amount then
      v_best_amount := v_candidate_amount;
      v_best := v_candidate;
    end if;
  end loop;

  return v_best;
end;
$$;

-- 7. create_order: wire in dynamic delivery fee + product-id collection ----
-- (needed for the new product-scoped/multi-target discount matching above).

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
             p.id as product_id, p.name as product_name
      into v_variant
      from product_variants pv join products p on p.id = pv.product_id
      where pv.id = (v_item->>'variant_id')::uuid;

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

  v_discount := resolve_best_discount(p_customer_id, v_merchant_ids, v_category_ids, v_product_ids, v_order_subtotal);

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

  select latitude, longitude into v_address from addresses where id = p_address_id;
  v_delivery_fee := resolve_delivery_fee(v_address.latitude, v_address.longitude, v_order_subtotal - v_discount_amount);

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

-- 8. Merchant approval/rejection notifications ------------------------------
-- Approving/rejecting a merchant happens as a plain client-side update from
-- the admin app (no edge function in the loop), so this is done as a
-- trigger rather than the sendNotification() TS helper used elsewhere.
-- rejection_reason/suspension_reason are in the Database spec's merchants
-- table but were never added here — add them now since the trigger below
-- needs one of them.

alter table merchants add column rejection_reason text;
alter table merchants add column suspension_reason text;

create or replace function notify_merchant_status_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_event text;
  v_template notification_templates;
  v_title text;
  v_body text;
begin
  if new.status = old.status then
    return new;
  end if;

  if new.status = 'active' then
    v_event := 'merchant_approved';
  elsif new.status = 'rejected' then
    v_event := 'merchant_rejected';
  else
    return new;
  end if;

  if not (select coalesce((value ->> 'in_app')::boolean, true) from system_settings where key = 'notification_channels') then
    return new;
  end if;

  select * into v_template from notification_templates
  where event_type = v_event and channel = 'in_app' and language = 'en';

  if v_template.id is null or not v_template.enabled then
    return new;
  end if;

  v_title := replace(v_template.title_template, '{{merchant_name}}', new.business_name);
  v_body := replace(replace(v_template.body_template, '{{merchant_name}}', new.business_name), '{{reason}}', coalesce(new.rejection_reason, ''));

  insert into notifications (user_id, type, title, body)
  values (new.owner_id, v_event, v_title, v_body);

  return new;
end;
$$;

create trigger merchants_notify_status_change
  after update on merchants
  for each row execute function notify_merchant_status_change();
