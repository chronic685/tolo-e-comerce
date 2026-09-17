-- Closes several "mandatory MVP" gaps from the Admin Control Matrix that had
-- no admin surface at all yet: account suspension (staff + customers),
-- featured products, and a couple of small RLS/permission additions needed
-- for the new Users, Customers, Products, Refunds and Audit Log admin pages.
-- (Products/Refunds RLS already allowed staff access via existing policies
-- — products_manage/refunds_manage_finance — so only the pieces below were
-- actually missing.)

create type account_status as enum ('active', 'suspended');

alter table profiles add column account_status account_status not null default 'active';
alter table products add column is_featured boolean not null default false;

-- A suspended account loses every staff privilege immediately: re-derive
-- every role helper to also require account_status = 'active', rather than
-- adding a second check everywhere these are called.
create or replace function is_tolo_staff()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and account_status = 'active' and role in (
      'tolo_ops', 'tolo_finance', 'tolo_admin',
      'tolo_marketing', 'tolo_support', 'tolo_merchant_verification'
    )
  );
$$;

create or replace function is_tolo_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and account_status = 'active' and role = 'tolo_admin'
  );
$$;

create or replace function is_tolo_finance()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and account_status = 'active' and role in ('tolo_finance', 'tolo_admin')
  );
$$;

create or replace function is_tolo_marketing()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and account_status = 'active' and role in ('tolo_marketing', 'tolo_admin')
  );
$$;

create or replace function is_tolo_support()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and account_status = 'active' and role in ('tolo_support', 'tolo_admin')
  );
$$;

create or replace function is_tolo_merchant_verification()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and account_status = 'active'
    and role in ('tolo_merchant_verification', 'tolo_admin')
  );
$$;

-- Only Super Admin manages other staff members' status/role (the existing
-- prevent_role_self_escalation trigger already restricts role changes the
-- same way; this extends that restriction to account_status too).
create or replace function prevent_status_self_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.account_status <> old.account_status and not is_tolo_admin() then
    raise exception 'Only tolo_admin can change account status';
  end if;
  return new;
end;
$$;

create trigger profiles_prevent_status_self_change
  before update on profiles
  for each row execute function prevent_status_self_change();

-- A suspended customer keeps read access (order history, support) but can't
-- place new orders — enforced here, not just hidden in the UI.
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
  v_customer_status account_status;
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

-- Audit log needs to be readable by more than just tolo_admin now that
-- several roles act on things that get logged (matches spec: "Operations:
-- View", "Finance: View", etc. in the permission matrix), not just Super Admin.
drop policy if exists "audit_logs_select_admin" on audit_logs;
create policy "audit_logs_select_staff" on audit_logs
  for select using (is_tolo_staff());
