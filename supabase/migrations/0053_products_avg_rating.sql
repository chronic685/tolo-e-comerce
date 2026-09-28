-- Marketplace.tsx's "Highest rated" sort used to re-sort every fetched row
-- client-side by averaging embedded reviews -- that only produces a
-- correct order when the whole result set is loaded into memory at once.
-- Real server-side pagination (.range(), one page at a time) needs the
-- database to do this ordering instead. This adds the products-level
-- equivalent of merchants_avg_rating (0045): same rationale --
-- products_public_select_published RLS (0014) only lets a customer see
-- published products, but a product's rating should reflect every review
-- ever left on it, and this only ever returns a derived aggregate number,
-- never row data, so there's nothing sensitive to leak by bypassing RLS
-- here.
create or replace function products_avg_rating(p products)
returns numeric
language sql stable security definer set search_path = public
as $$
  select round(avg(rating)::numeric, 1) from reviews where product_id = p.id;
$$;
