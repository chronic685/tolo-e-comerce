-- Group 3, item 12: merchant performance scores (acceptance rate, prep
-- speed, cancellations, rating), shown to merchants and admins. Rating
-- already existed (merchants_avg_rating/merchants_review_count, migration
-- 0045) -- these three new computed columns cover the rest, matching the
-- same "PostgREST computed column, security definer, read-only derived
-- number" pattern rather than a jsonb blob, so each stays individually
-- selectable/orderable (e.g. an admin list sorted by acceptance rate)
-- exactly like merchants_avg_rating already is.
--
-- All three are lifetime figures over merchant_orders, not windowed to a
-- period -- no "performance over the last 30 days" concept exists
-- anywhere else in this schema to match, and a merchant/admin picking a
-- custom window is a materially bigger feature than what was asked.

-- Denominator is every order that reached a real decision (accepted or
-- rejected) -- a still-'new' order hasn't been decided yet and would
-- unfairly count against a merchant who just hasn't gotten to it. Null
-- (not 0%) when there's no decided order yet, same "don't show a
-- misleadingly precise number from an empty sample" reasoning
-- variant_stock_remaining already uses (0054).
create or replace function merchant_acceptance_rate(m merchants)
returns numeric
language sql stable security definer set search_path = public
as $$
  select case when decided > 0 then round(accepted::numeric / decided * 100, 1) else null end
  from (
    select
      count(*) filter (where status <> 'new') as decided,
      count(*) filter (where status <> 'new' and status <> 'rejected') as accepted
    from merchant_orders where merchant_id = m.id
  ) counts;
$$;

-- Share of all orders (any status) the merchant cancelled after accepting
-- -- a customer's own cancellation (order-status/index.ts's
-- CUSTOMER_TRANSITIONS) isn't distinguishable from a merchant's by status
-- alone, so this counts every 'cancelled' order against the merchant; a
-- merchant being measured on cancellations they didn't initiate is a
-- known, accepted imprecision here rather than guessed at from
-- order_status_history.changed_by, which would need a materially larger
-- query.
create or replace function merchant_cancellation_rate(m merchants)
returns numeric
language sql stable security definer set search_path = public
as $$
  select case when total > 0 then round(cancelled::numeric / total * 100, 1) else null end
  from (
    select count(*) as total, count(*) filter (where status = 'cancelled') as cancelled
    from merchant_orders where merchant_id = m.id
  ) counts;
$$;

-- Minutes from "ORDER RECEIVED" (order_received_at) to "ready for
-- pickup" (ready_for_pickup_at) -- both already stamped by order-status/
-- index.ts's existing status transitions, nothing new to record. Only
-- orders that actually reached ready_for_pickup count; null with no such
-- order yet.
create or replace function merchant_avg_prep_minutes(m merchants)
returns numeric
language sql stable security definer set search_path = public
as $$
  select round(avg(extract(epoch from (ready_for_pickup_at - order_received_at)) / 60)::numeric, 1)
  from merchant_orders
  where merchant_id = m.id and order_received_at is not null and ready_for_pickup_at is not null;
$$;
