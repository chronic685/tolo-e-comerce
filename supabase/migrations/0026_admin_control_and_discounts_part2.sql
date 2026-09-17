-- Part 2 of the admin-control migration (split from 0025 because a new enum
-- value cannot be referenced in the same transaction that adds it).

-- 1. Role helpers for the new granular staff roles -----------------------

create or replace function is_tolo_marketing()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role in ('tolo_marketing', 'tolo_admin')
  );
$$;

create or replace function is_tolo_support()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role in ('tolo_support', 'tolo_admin')
  );
$$;

create or replace function is_tolo_merchant_verification()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid()
    and role in ('tolo_merchant_verification', 'tolo_admin')
  );
$$;

-- Broaden the general "is any kind of Tolo staff" check to include the new
-- roles (read access to shared admin views), without widening any of the
-- narrower write-permission checks below.
create or replace function is_tolo_staff()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role in (
      'tolo_ops', 'tolo_finance', 'tolo_admin',
      'tolo_marketing', 'tolo_support', 'tolo_merchant_verification'
    )
  );
$$;

-- Merchant approval/suspension is Merchant-Verification-or-Admin territory
-- (spec section 25/35), not every staff role.
drop policy if exists "merchants_update" on merchants;
create policy "merchants_update" on merchants
  for update using (
    owner_id = auth.uid() or is_tolo_merchant_verification()
  );

create policy "merchant_documents_review" on merchant_documents
  for update using (is_tolo_merchant_verification())
  with check (is_tolo_merchant_verification());

-- 2. Generic config-change log --------------------------------------------
-- Reuses audit_logs (actor/action/entity_type/entity_id/metadata/created_at)
-- instead of a parallel table: metadata carries {before, after} so section
-- 36's "previous value / new value / who / when" is answerable from one place.

create or replace function log_config_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- NEW/OLD are generic RECORD here (this function triggers on several
  -- tables with different columns): go through to_jsonb()->>'field' rather
  -- than new.field directly, since a bare field reference is resolved for
  -- every table this trigger is attached to, not just the one that fired,
  -- and errors on tables missing that column (e.g. system_settings has no
  -- "id") even inside a CASE branch that would otherwise skip it.
  insert into audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    nullif(to_jsonb(new)->>'id', '')::uuid,
    jsonb_build_object(
      'before', case when tg_op = 'INSERT' then null else to_jsonb(old) end,
      'after', to_jsonb(new),
      'key', to_jsonb(new)->>'key'
    )
  );
  return new;
end;
$$;

create trigger system_settings_log_change
  after insert or update on system_settings
  for each row execute function log_config_change();

create trigger commission_rules_log_change
  after insert or update on commission_rules
  for each row execute function log_config_change();

-- 3. Discount / promotion engine ------------------------------------------

create type discount_scope_type as enum ('platform', 'merchant', 'category', 'product');
create type discount_kind as enum ('percent', 'fixed');
create type discount_funded_by as enum ('tolo', 'merchant', 'shared');

create table discount_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  scope_type discount_scope_type not null default 'platform',
  scope_id uuid,
  discount_kind discount_kind not null,
  amount numeric(12,2) not null check (amount > 0),
  max_discount_amount numeric(12,2),
  min_order_value numeric(12,2) not null default 0,
  funded_by discount_funded_by not null default 'tolo',
  tolo_share_percent numeric(5,2),
  usage_limit int,
  usage_count int not null default 0,
  per_customer_limit int,
  first_order_only boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discount_rules_percent_range check (
    discount_kind <> 'percent' or amount <= 100
  ),
  constraint discount_rules_shared_share check (
    funded_by <> 'shared' or tolo_share_percent is not null
  )
);

create index idx_discount_rules_active_scope on discount_rules(scope_type, scope_id) where is_active;

create trigger discount_rules_set_updated_at
  before update on discount_rules
  for each row execute function set_updated_at();

create trigger discount_rules_log_change
  after insert or update on discount_rules
  for each row execute function log_config_change();

create table discount_redemptions (
  id uuid primary key default gen_random_uuid(),
  discount_rule_id uuid not null references discount_rules(id),
  order_id uuid not null references orders(id),
  customer_id uuid not null references profiles(id),
  discount_amount numeric(12,2) not null,
  created_at timestamptz not null default now()
);

create index idx_discount_redemptions_rule_customer on discount_redemptions(discount_rule_id, customer_id);

alter table discount_rules enable row level security;
alter table discount_redemptions enable row level security;

create policy "discount_rules_select" on discount_rules
  for select using (true);

create policy "discount_rules_manage" on discount_rules
  for all using (is_tolo_marketing() or is_tolo_admin())
  with check (is_tolo_marketing() or is_tolo_admin());

create policy "discount_redemptions_select" on discount_redemptions
  for select using (customer_id = auth.uid() or is_tolo_staff());

alter table orders add column discount_amount numeric(12,2) not null default 0;
alter table orders add column discount_rule_id uuid references discount_rules(id);
alter table merchant_orders add column discount_amount numeric(12,2) not null default 0;

-- Master on/off switch + a first set of admin-configurable business rules
-- (spec sections 2, 13-16) living in the existing system_settings table.
insert into system_settings (key, value) values
  ('discounts_enabled', 'true'::jsonb),
  ('min_order_value', '0'::jsonb),
  ('payment_methods', '{"cash_on_delivery": true, "bank_transfer": true, "mobile_money": true}'::jsonb),
  ('delivery', '{"enabled": true, "base_fee": 0, "free_delivery_threshold": null, "max_delivery_distance_km": null}'::jsonb),
  ('customer_features', '{"reviews_enabled": true, "wallet_enabled": false, "referrals_enabled": false, "guest_browsing_enabled": true}'::jsonb),
  ('merchant_features', '{"self_registration_enabled": true, "auto_publish_products": false, "bulk_upload_enabled": false}'::jsonb),
  ('merchant_new_order_alerts', '{"vibrate": true, "reminder_interval_minutes": 2, "escalate_after_minutes": 5}'::jsonb)
on conflict (key) do nothing;

-- 4. Wire discounts into checkout pricing ----------------------------------

-- Picks the single best (largest-discount) active, in-window, under-limit
-- rule applicable to this order. Scoped to the order as a whole (not
-- per-line) to keep multi-merchant carts tractable; a merchant/category
-- rule matches if any merchant/category in the cart matches its scope.
create or replace function resolve_best_discount(
  p_customer_id uuid,
  p_merchant_ids uuid[],
  p_category_ids uuid[],
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

  -- Discount resolution + funding split (spec sections 8-10): pick the best
  -- applicable rule, then distribute its amount across merchant_orders in
  -- proportion to their share of the order, debiting Tolo's commission,
  -- the merchant's payable, or both depending on who funds it.
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
