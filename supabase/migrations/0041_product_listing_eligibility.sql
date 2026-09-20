-- Merchant listing-eligibility rule: a product can only be published (or
-- submitted for approval) if at least stock >= 2 OR price >= 1000 ETB holds
-- for every one of its variants. Stock and price are both tracked per
-- product_variant (product_variants.price / inventory.stock_quantity), not
-- at the product level — a product's base_price is just the merchant's
-- default/display price, not what's actually charged or stocked, so the
-- rule is enforced per variant, and a product needs ALL of its variants to
-- individually qualify (there is no per-variant "hide from sale" flag in
-- this schema — a product is either published or it isn't, so a product
-- with one qualifying and one non-qualifying variant would otherwise let
-- the non-qualifying one slip through under cover of its sibling).
--
-- Draft products are exempt entirely (status not in published/submitted) —
-- merchants must be able to build out a listing before it's ready. Admin
-- product management is deliberately NOT exempt: Products.tsx's "Approve &
-- Publish" and "Republish" actions go through the exact same
-- products.status update as a merchant's own publish, and exempting admin
-- would reopen the loophole this rule exists to close (a merchant submits
-- a non-compliant product, admin approves it, it's live anyway). Admins can
-- still Pause/Archive/Reject a non-compliant product freely, and can still
-- edit any other field on it -- the check only fires on the specific
-- transition into published/submitted.
--
-- Existing data: checked the live project before writing this -- zero
-- published/submitted products currently violate the rule, and none have
-- zero variants either, so there was nothing to grandfather at deploy time.
-- The mechanism below still grandfathers correctly regardless: it only
-- re-checks a row on an ACTUAL value change (old IS DISTINCT FROM new) on
-- update, never on an unrelated resave, and never retroactively against
-- rows that existed before this migration. If a non-compliant row is ever
-- created some other way (e.g. a future data migration) it stays published
-- and untouched until someone actually edits its price/stock/status again.

create or replace function assert_product_listing_eligible(p_product_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_status text;
  v_total int;
  v_failing int;
begin
  select status into v_status from products where id = p_product_id;
  if v_status is null or v_status not in ('published', 'submitted') then
    return;
  end if;

  select count(*), count(*) filter (where pv.price < 1000 and coalesce(i.stock_quantity, 0) < 2)
  into v_total, v_failing
  from product_variants pv
  left join inventory i on i.variant_id = pv.id
  where pv.product_id = p_product_id;

  if v_total = 0 or v_failing > 0 then
    raise exception 'Products need either 2+ units in stock or a price of at least 1000 ETB to be listed for sale';
  end if;
end;
$$;

revoke execute on function assert_product_listing_eligible(uuid) from public, anon, authenticated;

-- 1. products: re-check only on an actual transition INTO published/submitted
-- -- never on INSERT. A brand-new product is inserted by ProductForm.tsx
-- before its variants/inventory exist (they're written in separate,
-- un-transacted follow-up calls), so there is nothing to check yet at that
-- instant; checking on INSERT would make it impossible to ever create a new
-- published product at all. The inventory trigger below is what actually
-- catches a new product once its variants' stock is set.
create or replace function trg_check_listing_on_product_status_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.status in ('published', 'submitted') and old.status is distinct from new.status then
    perform assert_product_listing_eligible(new.id);
  end if;
  return new;
end;
$$;

create trigger products_check_listing_eligibility
  after update on products
  for each row execute function trg_check_listing_on_product_status_change();

-- 2. product_variants: re-check only on an actual price change to an
-- EXISTING variant -- not on INSERT, for the same reason as above (a new
-- variant's inventory row doesn't exist yet at insert time).
create or replace function trg_check_listing_on_variant_price_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if old.price is distinct from new.price then
    perform assert_product_listing_eligible(new.product_id);
  end if;
  return new;
end;
$$;

create trigger product_variants_check_listing_eligibility
  after update on product_variants
  for each row execute function trg_check_listing_on_variant_price_change();

-- 3. inventory: the one place that reliably sees the final, complete
-- price+stock combination for a brand-new variant (ProductForm.tsx always
-- upserts inventory last, after the variant's price is already saved), and
-- also catches a merchant directly editing stock down on an existing
-- variant. Guarded by app.bypass_listing_check so this never interferes
-- with the system's own stock movements -- release_stock()'s p_as_sale
-- branch legitimately depletes stock_quantity as real sales complete, and
-- restock_on_return_received() legitimately adds it back -- neither has
-- anything to do with a merchant choosing to list/delist a product, and
-- both are set below to skip this check entirely rather than risk blocking
-- an unrelated sale or a return refund because the product happens to sit
-- below the threshold regardless of this specific write.
create or replace function trg_check_listing_on_inventory_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_product_id uuid;
begin
  if coalesce(current_setting('app.bypass_listing_check', true), 'false') = 'true' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.stock_quantity is not distinct from new.stock_quantity then
    return new;
  end if;

  select product_id into v_product_id from product_variants where id = new.variant_id;
  if v_product_id is not null then
    perform assert_product_listing_eligible(v_product_id);
  end if;
  return new;
end;
$$;

create trigger inventory_check_listing_eligibility
  after insert or update on inventory
  for each row execute function trg_check_listing_on_inventory_change();

-- Opt the two existing system-driven stock movements out of the check above.
-- Same signatures/behavior as before, plus one line each setting a
-- transaction-local flag before touching stock_quantity.
create or replace function release_stock(p_variant_id uuid, p_quantity int, p_reference_id uuid, p_as_sale boolean default false)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  perform set_config('app.bypass_listing_check', 'true', true);

  if p_as_sale then
    update inventory
    set stock_quantity = stock_quantity - p_quantity,
        reserved_quantity = reserved_quantity - p_quantity
    where variant_id = p_variant_id;

    insert into inventory_movements (variant_id, movement_type, quantity, reference_type, reference_id)
    values (p_variant_id, 'sale', p_quantity, 'order', p_reference_id);
  else
    update inventory
    set reserved_quantity = reserved_quantity - p_quantity
    where variant_id = p_variant_id;

    insert into inventory_movements (variant_id, movement_type, quantity, reference_type, reference_id)
    values (p_variant_id, 'release', p_quantity, 'order', p_reference_id);
  end if;
end;
$$;

create or replace function restock_on_return_received()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_item record;
begin
  perform set_config('app.bypass_listing_check', 'true', true);

  for v_item in
    select variant_id, quantity
    from order_items
    where merchant_order_id = new.merchant_order_id
  loop
    update inventory
    set stock_quantity = stock_quantity + v_item.quantity
    where variant_id = v_item.variant_id;

    insert into inventory_movements (variant_id, movement_type, quantity, reference_type, reference_id)
    values (v_item.variant_id, 'restock', v_item.quantity, 'return', new.id);
  end loop;

  return new;
end;
$$;
