-- PR #6 review fix: the admin "Unacknowledged Orders" queue (Orders.tsx)
-- and "Approved — Awaiting Refund" queue (Refunds.tsx) were both a single
-- `.limit(200)` fetch with no real pagination -- past 200 matching rows,
-- older items (the ones most likely to actually be overdue) silently fell
-- off the end with no indication anything was hidden. Refunds must never
-- be silently hidden.
--
-- Both queues were unpaginated because their filter couldn't be expressed
-- as a plain PostgREST column filter (a time-relative threshold read from
-- system_settings, and a NOT EXISTS check against `refunds`). This adds a
-- computed-column function for each -- same "PostgREST computed column"
-- pattern as variant_stock_status (0054), products_avg_rating (0053), and
-- merchants_avg_rating (0045) -- so the filter becomes a normal
-- `.eq(..., true)`, and the admin pages can switch to real
-- `count: "exact"` + `.range()` pagination like every other admin list.
-- Neither function exposes anything the caller couldn't already read: both
-- only ever return a derived boolean over rows the admin already has RLS
-- access to.

-- Mirrors escalate_unacknowledged_orders()'s own threshold logic
-- (migration 0033) and the client-side isUnacknowledged() heuristic in
-- Orders.tsx -- same three conditions (still "new", never received,
-- notification sent longer ago than the configured
-- merchant_new_order_alerts.escalate_after_minutes), so the admin queue
-- and the real escalation cron always agree on what counts as overdue.
-- security definer: reads system_settings, which this function's caller
-- (Tolo staff) can already read directly (Orders.tsx does today), but
-- keeping it definer matches every other computed column here and avoids
-- coupling this function's behavior to system_settings' own RLS policy.
create or replace function merchant_orders_unacknowledged(mo merchant_orders)
returns boolean
language sql stable security definer set search_path = public
as $$
  select mo.status = 'new'
    and mo.order_received_at is null
    and mo.notification_sent_at is not null
    and mo.notification_sent_at <= now() - (
      coalesce(
        (select (value ->> 'escalate_after_minutes')::numeric
         from system_settings where key = 'merchant_new_order_alerts'),
        5
      ) || ' minutes'
    )::interval;
$$;

-- "Awaiting refund" = approved/received but no refund row has been opened
-- for it yet -- the same `r.refunds.length === 0` check Refunds.tsx used
-- to do client-side against an unpaginated 200-row fetch.
create or replace function returns_awaiting_refund(r returns)
returns boolean
language sql stable security definer set search_path = public
as $$
  select r.status in ('approved', 'received')
    and not exists (select 1 from refunds where return_id = r.id);
$$;
