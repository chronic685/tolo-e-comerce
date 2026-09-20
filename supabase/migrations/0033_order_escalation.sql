-- Phase 4: server-side unacknowledged-order escalation. Merchant order
-- acknowledgement itself is unchanged — this only adds a reliable,
-- server-side backstop for orders nobody acknowledges, replacing the
-- previous "only works while the merchant's browser tab stays open"
-- behavior (NewOrderAlert.tsx's local repeat-vibrate loop).
--
-- Configuration: reuses system_settings.merchant_new_order_alerts
-- .escalate_after_minutes — the field already surfaced in the admin
-- dashboard (admin-dashboard/src/pages/Settings.tsx, labeled "Escalate to
-- Tolo ops after (minutes)"). There is a second, older setting,
-- unacknowledged_order_escalation_minutes (seeded in
-- 0023_order_acknowledgement.sql), but nothing — including the admin UI —
-- ever reads or writes it; it has no way for an admin to actually change
-- it. Wiring escalation to the field an admin can actually edit is both
-- "use the existing configuration mechanism" and "do not create a second
-- setting" — the alternative would have left the UI field permanently
-- disconnected from real behavior. The older key is left untouched.

alter table merchant_orders
  add column if not exists escalated_at timestamptz;

-- Supports the escalation job's per-minute query (status/escalated_at
-- equality plus a range scan on notification_sent_at) without scanning
-- every merchant_order — stays small because most orders leave "new"
-- within minutes, long before they'd ever need to be considered here.
create index if not exists idx_merchant_orders_unacknowledged
  on merchant_orders (notification_sent_at)
  where status = 'new' and escalated_at is null;

insert into notification_templates (event_type, title_template, body_template) values
  ('order_unacknowledged_escalated', 'Unacknowledged order — {{merchant_name}}',
   'Order #{{order_id_short}} from {{merchant_name}} has not been acknowledged for {{waiting_minutes}} minutes.')
on conflict (event_type, channel, language) do nothing;

-- The actual escalation check. Pure SQL/PL/pgSQL (no Edge Function, no
-- pg_net) — the whole job is a database read+write plus an insert into the
-- existing notifications table, so there is nothing here for pg_net's
-- HTTP-calling capability to usefully do, and no HTTP endpoint is
-- introduced at all. It's still a security definer function though, and
-- Postgres grants EXECUTE on new functions to PUBLIC by default — which
-- PostgREST would otherwise auto-expose as a callable RPC to any
-- authenticated customer/merchant. The REVOKE below (after the function is
-- created) is what actually prevents that; without it, this comment alone
-- would not be true.
create or replace function escalate_unacknowledged_orders()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_threshold_minutes numeric;
  v_in_app_enabled boolean;
  v_claimed record;
  v_ops_user record;
  v_merchant_name text;
  v_waiting_minutes integer;
  v_count integer := 0;
begin
  select (value ->> 'escalate_after_minutes')::numeric into v_threshold_minutes
  from system_settings where key = 'merchant_new_order_alerts';

  -- Missing/malformed/non-positive configuration must never escalate every
  -- order or spam notifications every minute — fail safe by doing nothing
  -- rather than guessing a default threshold.
  if v_threshold_minutes is null or v_threshold_minutes <= 0 then
    return 0;
  end if;

  select coalesce((value ->> 'in_app')::boolean, true) into v_in_app_enabled
  from system_settings where key = 'notification_channels';

  for v_claimed in
    -- Atomic claim: the escalated_at IS NULL guard in the WHERE clause is
    -- what makes this idempotent under concurrent/repeated execution — two
    -- overlapping runs of this function can never both see the same row
    -- as claimable, the same way a payment or order-status update can't be
    -- double-applied elsewhere in this codebase.
    update merchant_orders
    set escalated_at = now()
    where status = 'new'
      and order_received_at is null
      and escalated_at is null
      and notification_sent_at is not null
      and notification_sent_at <= now() - (v_threshold_minutes || ' minutes')::interval
    returning id, merchant_id, notification_sent_at
  loop
    v_count := v_count + 1;

    if v_in_app_enabled then
      -- Isolated per order: one bad/unexpected failure here must not stop
      -- the loop from escalating the remaining orders, and must never
      -- un-claim the order above — escalated_at already committed is the
      -- authoritative record Operations/reporting relies on; notification
      -- delivery is best-effort on top of it (the same failure-isolation
      -- principle already applied to every other notification in this
      -- codebase — see _shared/notify.ts).
      begin
        select business_name into v_merchant_name from merchants where id = v_claimed.merchant_id;
        v_waiting_minutes := greatest(0, floor(extract(epoch from (now() - v_claimed.notification_sent_at)) / 60))::integer;

        for v_ops_user in
          select id from profiles where role in ('tolo_ops', 'tolo_admin') and account_status = 'active'
        loop
          insert into notifications (user_id, type, title, body)
          select
            v_ops_user.id,
            t.event_type,
            replace(t.title_template, '{{merchant_name}}', coalesce(v_merchant_name, 'a merchant')),
            replace(replace(replace(t.body_template,
              '{{order_id_short}}', left(v_claimed.id::text, 8)),
              '{{merchant_name}}', coalesce(v_merchant_name, 'a merchant')),
              '{{waiting_minutes}}', v_waiting_minutes::text)
          from notification_templates t
          where t.event_type = 'order_unacknowledged_escalated' and t.channel = 'in_app' and t.language = 'en' and t.enabled;
        end loop;
      exception when others then
        raise warning 'escalate_unacknowledged_orders: notification failed for merchant_order %: %', v_claimed.id, sqlerrm;
      end;
    end if;
  end loop;

  return v_count;
end;
$$;

-- Only the database owner (what pg_cron runs as) and the service role may
-- invoke this — no customer, merchant, or anon/authenticated PostgREST
-- caller can trigger an escalation sweep on demand.
revoke execute on function escalate_unacknowledged_orders() from public;
revoke execute on function escalate_unacknowledged_orders() from anon;
revoke execute on function escalate_unacknowledged_orders() from authenticated;

-- Scheduling. pg_cron/pg_net are available on this project (confirmed via
-- pg_available_extensions) but were not previously installed — this is the
-- first migration in the project to use either, and only pg_cron is
-- actually needed here (see the function comment above for why pg_net is
-- not required for this design).
create extension if not exists pg_cron;

-- Idempotent regardless of pg_cron version behavior around re-scheduling a
-- job with the same name.
select cron.unschedule(jobid) from cron.job where jobname = 'escalate-unacknowledged-orders';
select cron.schedule('escalate-unacknowledged-orders', '* * * * *', $$select escalate_unacknowledged_orders();$$);
