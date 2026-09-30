-- Fix for a bug in migration 0067 (finance reconciliation report):
-- finance_reconciliation_rows() declares `order_id uuid` and
-- `created_at timestamptz` as columns of its RETURNS TABLE, which
-- PL/pgSQL also exposes as implicit variables of those same names in
-- scope for the whole function body. The lateral subquery's
-- `where order_id = o.id order by created_at desc` was therefore
-- ambiguous on BOTH columns -- each could mean the implicit variable or
-- the matching payments column -- and Postgres rejects the call outright
-- (42702) rather than guessing. The `order_id` half was qualified in an
-- earlier version of this same migration; CI's next fresh-migration run
-- then hit the identical ambiguity on `created_at`, so both are fixed
-- here together. Caught by CI against a fresh migration (the live local
-- sandbox this repo's tests otherwise run against, see tests/README.md,
-- was running an older/patched definition that didn't hit this).
create or replace function finance_reconciliation_rows(p_from timestamptz, p_to timestamptz)
returns table (
  order_id uuid,
  order_number bigint,
  created_at timestamptz,
  customer_name text,
  subtotal numeric,
  discount_amount numeric,
  delivery_fee numeric,
  rider_tip numeric,
  total numeric,
  payment_provider text,
  payment_status text,
  payment_amount numeric,
  refunded_amount numeric
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not (is_tolo_finance() or has_admin_page(array['finance_reconciliation'])) then
    raise exception 'Not authorized';
  end if;

  return query
  select
    o.id, o.order_number, o.created_at, p.full_name,
    o.subtotal, o.discount_amount, o.delivery_fee, o.rider_tip, o.total,
    pay.provider, pay.status::text, pay.amount,
    coalesce(ref.refunded, 0)
  from orders o
  join profiles p on p.id = o.customer_id
  left join lateral (
    select provider, status, amount from payments where payments.order_id = o.id order by payments.created_at desc limit 1
  ) pay on true
  left join lateral (
    select sum(f.amount) as refunded
    from merchant_orders mo
    join returns r on r.merchant_order_id = mo.id
    join refunds f on f.return_id = r.id
    where mo.order_id = o.id
  ) ref on true
  where o.created_at >= p_from and o.created_at < p_to
  order by o.created_at desc;
end;
$$;
