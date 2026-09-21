-- Merchant-level rating, rolled up from the existing per-product reviews
-- table. Nothing aggregated review data to a merchant score anywhere
-- before this.
--
-- Chose two computed-column functions (merchants_avg_rating/
-- merchants_review_count), the same pattern products_customer_price /
-- product_variants_customer_price already use (migration 0021) for
-- exactly this reason: PostgREST exposes a function taking a table's row
-- type as its single argument as if it were a real column of that table,
-- selectable via "alias:function_name" and usable directly for a single
-- merchant's storefront lookup with no extra round trip. A real column
-- (denormalized/materialized) would need a trigger on every reviews
-- insert/update/delete to stay in sync and would still be wrong the moment
-- someone edited a review directly; a plain SQL view joining
-- reviews -> products -> merchants would work too, but a computed column is
-- less code and fits how this exact rollup (review -> product -> merchant)
-- already gets done in this schema for price instead of rating.
--
-- Unlike products_customer_price (deliberately NOT security definer, so
-- PostgREST resolves it as the requesting role when embedding it — see
-- migration 0021), these ARE security definer. products_public_select_published
-- RLS (migration 0014) only lets an anonymous/customer caller see
-- status='published' products; a merchant's rating should reflect their
-- real review history regardless of whether a given reviewed product
-- happens to be paused/archived right now, not silently shrink depending
-- on the caller's role or a product's current listing state. Both
-- functions only ever return a derived aggregate number (avg/count), never
-- row data, so there's nothing sensitive to leak by bypassing RLS here.
create or replace function merchants_avg_rating(m merchants)
returns numeric
language sql stable security definer set search_path = public
as $$
  select round(avg(r.rating)::numeric, 1)
  from reviews r
  join products p on p.id = r.product_id
  where p.merchant_id = m.id;
$$;

create or replace function merchants_review_count(m merchants)
returns bigint
language sql stable security definer set search_path = public
as $$
  select count(*)
  from reviews r
  join products p on p.id = r.product_id
  where p.merchant_id = m.id;
$$;
