-- Group 4, item 17: "Admin finance reconciliation report (orders,
-- payments, refunds, payouts; CSV export; permission-gated)."
--
-- No admin page today shows orders/payments/refunds/payouts together for
-- a given period -- Payments.tsx, Refunds.tsx and Settlements.tsx are each
-- their own operational queue. This adds two read-only, period-scoped
-- functions (a single-row summary for the headline figures, and a
-- row-level export for the CSV) rather than reusing per-table RLS: both
-- are SECURITY DEFINER with their own explicit authorization check, so
-- nothing here needed to widen orders_select/payments/refunds RLS to a
-- new page key -- the blast radius stays inside these two functions.
--
-- Gate: is_tolo_finance() (payments/refunds/settlements -- the existing
-- "finance staff" bundle, migration 0051) OR the new dedicated
-- 'finance_reconciliation' page key, so a narrowly-scoped report-only
-- admin can be granted just this without full finance access.

create or replace function finance_reconciliation_summary(p_from timestamptz, p_to timestamptz)
returns table (
  orders_count bigint,
  orders_subtotal numeric,
  orders_discount numeric,
  orders_delivery_fee numeric,
  orders_rider_tip numeric,
  orders_total numeric,
  payments_collected numeric,
  refunds_issued numeric,
  commission_earned numeric,
  payouts_paid numeric
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not (is_tolo_finance() or has_admin_page(array['finance_reconciliation'])) then
    raise exception 'Not authorized';
  end if;

  return query
  select
    count(*)::bigint,
    coalesce(sum(o.subtotal), 0),
    coalesce(sum(o.discount_amount), 0),
    coalesce(sum(o.delivery_fee), 0),
    coalesce(sum(o.rider_tip), 0),
    coalesce(sum(o.total), 0),
    (select coalesce(sum(amount), 0) from payments where status = 'verified' and created_at >= p_from and created_at < p_to),
    (select coalesce(sum(f.amount), 0) from refunds f where f.created_at >= p_from and f.created_at < p_to),
    (select coalesce(sum(mo.commission_amount), 0)
       from merchant_orders mo join orders oo on oo.id = mo.order_id
       where oo.created_at >= p_from and oo.created_at < p_to),
    (select coalesce(sum(s.total_amount), 0) from settlements s where s.status = 'paid' and s.paid_at >= p_from and s.paid_at < p_to)
  from orders o
  where o.created_at >= p_from and o.created_at < p_to;
end;
$$;

-- Row-level detail behind the CSV export -- returns a real table/setof, so
-- the admin client can chain .range() on it exactly like a normal table
-- query (fetchAllRows, PR #6 review fix) to page past PostgREST's
-- max_rows cap for a large date range instead of silently truncating it.
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
    select provider, status, amount from payments where order_id = o.id order by created_at desc limit 1
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
