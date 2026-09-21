-- Customer-facing promo codes. discount_rules already models every kind of
-- discount (percent/fixed, scoped to platform/merchant/category/product,
-- funding split, usage caps) but resolve_best_discount() only ever matched
-- rules by scope -- there was no way for a customer to type anything in.
-- This wires up the already-existing (but dead) customer_features.
-- promo_codes_enabled toggle (migration 0027, admin-dashboard Settings.tsx).
--
-- 1. Schema: nullable, unique code on discount_rules -----------------------
-- Nullable because a code-based discount is a new KIND of rule alongside
-- the existing automatic ones, not a replacement -- every existing rule
-- keeps applying automatically with code left null. A partial unique index
-- (not a plain column constraint) mirrors idx_favorites_customer_product's
-- exact pattern (migration 0029): a plain `unique` constraint would work
-- the same way here since Postgres already treats NULLs as non-conflicting,
-- but the partial index makes "unique only when actually set" explicit.

alter table discount_rules add column code text;

create unique index idx_discount_rules_code on discount_rules(code) where code is not null;

-- Codes are matched case-insensitively (a customer typing "save10" should
-- match "SAVE10"), and a case-sensitive unique index would otherwise let
-- both variants exist as distinct rows. Normalizing to uppercase on write
-- is simpler and more robust than relying on every caller (admin UI,
-- direct API access, future scripts) to remember to do it themselves.
create or replace function normalize_discount_code()
returns trigger
language plpgsql
as $$
begin
  if new.code is not null then
    new.code := nullif(upper(trim(new.code)), '');
  end if;
  return new;
end;
$$;

create trigger discount_rules_normalize_code
  before insert or update on discount_rules
  for each row execute function normalize_discount_code();

-- 2. resolve_best_discount(): accept an optional code, best-of with automatic
-- -----------------------------------------------------------------------
-- Stacking decision: a code-based discount is added into the SAME
-- candidate pool as the automatic scope-based ones, and whichever is worth
-- more for this order wins -- not stacked on top of an automatic discount,
-- and not code-only-if-no-automatic-applies. Reasons:
--   - orders.discount_rule_id / merchant_orders.discount_amount only ever
--     record ONE discount rule per order (see 0026's schema) -- actually
--     stacking two discounts would need a real schema change (a join table
--     of applied discounts) that the task explicitly said to avoid unless
--     genuinely necessary, and it isn't for this feature.
--   - "best-of" is strictly customer-friendly: entering a code can never
--     make an order worse off than not entering one, since the bigger
--     number always wins regardless of source.
--   - It also protects Tolo/merchant margin: a customer can't combine a
--     platform-wide automatic sale with a merchant's promo code to stack
--     two discounts into one order.
-- A rule with code is not null is code-gated: it's excluded from the
-- automatic pool entirely unless the caller supplied that exact code. A
-- rule with code is null is unaffected either way, exactly as before this
-- migration. Scope/min-order-value/usage-limit/per-customer-limit/
-- first-order-only all still apply identically to a code-matched rule --
-- a merchant-scoped code still only works when that merchant is in the
-- cart, same as a merchant-scoped automatic rule.
drop function if exists resolve_best_discount(uuid, uuid[], uuid[], uuid[], numeric);

create or replace function resolve_best_discount(
  p_customer_id uuid,
  p_merchant_ids uuid[],
  p_category_ids uuid[],
  p_product_ids uuid[],
  p_order_subtotal numeric,
  p_code text default null
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
  v_code text := nullif(upper(trim(coalesce(p_code, ''))), '');
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
      and (code is null or code = v_code)
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

-- Recreating a function via DROP + CREATE resets its grants to the
-- default (EXECUTE granted to PUBLIC) -- migration 0035's revoke of the
-- old 5-arg signature does not carry over to this new 6-arg one. Without
-- this, resolve_best_discount would silently become callable by
-- anon/authenticated again (tests/unit/function-privileges.test.ts's
-- "every function Phase 5b explicitly locked down..." test exists to catch
-- exactly this).
revoke execute on function resolve_best_discount(uuid, uuid[], uuid[], uuid[], numeric, text) from public, anon, authenticated;

-- 3. create_order(): thread the code through to resolve_best_discount -----
drop function if exists create_order(uuid, uuid, jsonb);

create or replace function create_order(p_customer_id uuid, p_address_id uuid, p_items jsonb, p_code text default null)
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

  select latitude, longitude into v_address from addresses where id = p_address_id;

  select value into v_delivery_settings from system_settings where key = 'delivery';
  v_delivery_enabled := coalesce((v_delivery_settings->>'enabled')::boolean, true);
  v_max_distance_km := nullif(v_delivery_settings->>'max_delivery_distance_km', '')::numeric;

  select (value #>> '{}')::numeric into v_min_order_value
  from system_settings where key = 'min_order_value';
  v_min_order_value := coalesce(v_min_order_value, 0);

  insert into orders (customer_id, address_id) values (p_customer_id, p_address_id)
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

revoke execute on function create_order(uuid, uuid, jsonb, text) from public, anon, authenticated;

-- 4. validate_discount_code(): preview a code against the current cart ----
-- Checkout.tsx needs to tell a customer whether a code they typed is
-- valid, expired/invalid, or just not applicable to their current cart --
-- resolve_best_discount() can't answer that (it silently returns the best
-- rule or null with no reason, and it's revoked from anon/authenticated
-- anyway; see migration 0035). This is a separate, deliberately narrow
-- function instead of loosening resolve_best_discount's grants:
-- resolve_best_discount decides real money at order-creation time and
-- must stay server-only, this only ever returns a status string + a
-- derived preview number for the CALLING customer's own cart.
--
-- Deliberately NOT security definer: discount_rules is already publicly
-- readable (discount_rules_select using (true), migration 0026) and this
-- only ever needs the CALLING customer's own discount_redemptions/orders
-- rows (per_customer_limit, first_order_only), which their own RLS
-- policies already allow them to read. Running as the original caller
-- means it can never see another customer's redemption history, even by
-- accident. auth.uid() is used directly rather than trusting a
-- client-supplied customer id, matching enforce_review_rate_limit's same
-- reasoning (migration 0032).
create or replace function validate_discount_code(
  p_code text,
  p_merchant_ids uuid[],
  p_category_ids uuid[],
  p_product_ids uuid[],
  p_order_subtotal numeric
)
returns table (status text, discount_amount numeric, rule_name text)
language plpgsql stable set search_path = public
as $$
declare
  v_customer_id uuid := auth.uid();
  v_rule discount_rules;
  v_is_first_order boolean;
  v_amount numeric;
  v_code text := nullif(upper(trim(coalesce(p_code, ''))), '');
begin
  if v_code is null then
    return query select 'invalid'::text, null::numeric, null::text;
    return;
  end if;

  select * into v_rule from discount_rules where code = v_code;

  if v_rule.id is null
     or not v_rule.is_active
     or (v_rule.starts_at is not null and v_rule.starts_at > now())
     or (v_rule.ends_at is not null and v_rule.ends_at < now())
     or (v_rule.usage_limit is not null and v_rule.usage_count >= v_rule.usage_limit)
  then
    return query select 'invalid'::text, null::numeric, null::text;
    return;
  end if;

  select not exists (select 1 from orders where customer_id = v_customer_id) into v_is_first_order;

  if (v_rule.first_order_only and not v_is_first_order)
     or p_order_subtotal < v_rule.min_order_value
     or (
       v_rule.per_customer_limit is not null
       and (
         select count(*) from discount_redemptions
         where discount_rule_id = v_rule.id and customer_id = v_customer_id
       ) >= v_rule.per_customer_limit
     )
     or (
       v_rule.scope_type <> 'platform'
       and not (
         (v_rule.scope_type = 'merchant' and v_rule.scope_id = any(p_merchant_ids))
         or (v_rule.scope_type = 'category' and v_rule.scope_id = any(p_category_ids))
         or (v_rule.scope_type = 'product' and v_rule.scope_id = any(p_product_ids))
         or exists (
           select 1 from discount_targets dt
           where dt.discount_id = v_rule.id
             and (
               (dt.target_type = 'merchant' and dt.target_id = any(p_merchant_ids))
               or (dt.target_type = 'category' and dt.target_id = any(p_category_ids))
               or (dt.target_type = 'product' and dt.target_id = any(p_product_ids))
             )
         )
       )
     )
  then
    return query select 'not_applicable'::text, null::numeric, v_rule.name;
    return;
  end if;

  if v_rule.discount_kind = 'percent' then
    v_amount := p_order_subtotal * v_rule.amount / 100;
    if v_rule.max_discount_amount is not null then
      v_amount := least(v_amount, v_rule.max_discount_amount);
    end if;
  else
    v_amount := least(v_rule.amount, p_order_subtotal);
  end if;

  return query select 'valid'::text, v_amount, v_rule.name;
end;
$$;
