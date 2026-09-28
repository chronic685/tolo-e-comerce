-- Customer-facing product availability. Customers cannot read `inventory`
-- directly (RLS: migration 0014 only grants SELECT to the owning
-- merchant's members or Tolo staff) and this doesn't change that -- it
-- adds two PostgREST "computed column" functions on product_variants
-- (same pattern as product_variants_customer_price, 0021, and
-- merchants_avg_rating, 0045) that expose only a derived status, never a
-- raw stock_quantity/reserved_quantity/available_quantity number, except
-- for the deliberately narrow "Only N left" case the task calls for.
--
-- security definer set search_path = public, matching every other
-- security-definer computed column in this schema (0035/0045): this reads
-- across the inventory RLS boundary, but only ever returns a derived
-- label/small integer, never a row from the protected table.
--
-- A variant with no inventory row at all is treated as out_of_stock
-- (defensive -- every real variant should have one, from reserve_stock/
-- release_stock's own invariants, but this must never return NULL/crash
-- for a variant that somehow doesn't).
create or replace function variant_stock_status(v product_variants)
returns text
language sql stable security definer set search_path = public
as $$
  select case
    when avail <= 0 then 'out_of_stock'
    when avail <= 5 then 'low'
    else 'in_stock'
  end
  from (select coalesce((select available_quantity from inventory where variant_id = v.id), 0) as avail) s;
$$;

-- Only non-null when status = 'low' (1-5 units left) -- never exposes a
-- count above that, and never the raw stock_quantity/reserved_quantity
-- split behind it.
create or replace function variant_stock_remaining(v product_variants)
returns int
language sql stable security definer set search_path = public
as $$
  select case when avail between 1 and 5 then avail else null end
  from (select coalesce((select available_quantity from inventory where variant_id = v.id), 0) as avail) s;
$$;
