-- Group 1, item 3: human-readable, sequence-based order numbers (shown as
-- "TL-1234" everywhere an order currently shows an id.slice(0, 8) UUID
-- fragment) instead of a random-looking hex prefix. order_number is a
-- plain bigint; the "TL-" prefix is applied client-side/in templates, not
-- stored, so it stays easy to reformat later without another migration.
--
-- Starts at 1001 rather than 1 -- purely cosmetic (a fresh platform's
-- first order reads "TL-1001", not "TL-1"), no functional reason.
create sequence order_number_seq start 1001;

-- Added nullable/no-default first: UPDATE has no ORDER BY, so a column
-- default that calls nextval() directly during ADD COLUMN would number
-- existing rows in whatever order Postgres happens to scan them in, not
-- chronological order. Computing the numbers explicitly below (via
-- row_number() over an ORDER BY created_at) and assigning them directly
-- is deterministic; nextval() is only wired up afterward, for new rows.
alter table orders add column order_number bigint;

-- Oldest order gets the lowest number -- matches what a human expects
-- ("order 1" was placed before "order 2"), not insertion/physical order.
with numbered as (
  select id, 1000 + row_number() over (order by created_at, id) as new_number
  from orders
)
update orders o
set order_number = numbered.new_number
from numbered
where o.id = numbered.id;

alter table orders alter column order_number set not null;
alter table orders alter column order_number set default nextval('order_number_seq');
alter table orders add constraint orders_order_number_unique unique (order_number);

-- Advance the sequence past every backfilled number (is_called = true, the
-- default) so the very next real INSERT's nextval() can't collide with one
-- just assigned above. A no-op default of 1000 on an empty orders table
-- leaves the sequence at its own START value (1001).
select setval('order_number_seq', greatest((select coalesce(max(order_number), 1000) from orders), 1000));

-- Friendlier default notification copy: order_number instead of the UUID
-- fragment. Every call site that fills {{order_number}} (payment_finalize.ts,
-- order-status/index.ts, delivery-dispatch/index.ts, escalate_unacknowledged_orders())
-- also still fills {{order_id_short}}, so a template an admin has already
-- customized to reference the old variable keeps working unchanged -- this
-- only rewrites the *current* template text in the table (seeded default,
-- unless an admin already edited it away from that default).
update notification_templates
set body_template = replace(body_template, '{{order_id_short}}', '{{order_number}}')
where body_template like '%{{order_id_short}}%';

update notification_templates
set title_template = replace(title_template, '{{order_id_short}}', '{{order_number}}')
where title_template like '%{{order_id_short}}%';

-- The literal "#" in front of the old UUID fragment reads oddly in front
-- of a formatted "TL-1234" number that already carries its own prefix --
-- drop the redundant "#" this one migration's replace() just introduced
-- (nothing else in these strings changes).
update notification_templates
set body_template = replace(body_template, '#{{order_number}}', '{{order_number}}'),
    title_template = replace(title_template, '#{{order_number}}', '{{order_number}}')
where body_template like '%#{{order_number}}%' or title_template like '%#{{order_number}}%';

-- The UPDATE above rewrites order_unacknowledged_escalated's template text
-- (seeded in migration 0033) to reference {{order_number}} -- this
-- redefinition of escalate_unacknowledged_orders() (latest previously in
-- migration 0051) is what actually makes that substitution resolve, by
-- also looking up and filling order_number, the same way it already looks
-- up and fills merchant_name. Without this, every future escalation
-- notification would show the literal, unresolved "{{order_number}}" text.
-- Identical to 0051's version otherwise (same threshold/claim/notify
-- logic) -- only the notification-filling block changes.
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
  v_order_number bigint;
  v_waiting_minutes integer;
  v_count integer := 0;
begin
  select (value ->> 'escalate_after_minutes')::numeric into v_threshold_minutes
  from system_settings where key = 'merchant_new_order_alerts';

  if v_threshold_minutes is null or v_threshold_minutes <= 0 then
    return 0;
  end if;

  select coalesce((value ->> 'in_app')::boolean, true) into v_in_app_enabled
  from system_settings where key = 'notification_channels';

  for v_claimed in
    update merchant_orders
    set escalated_at = now()
    where status = 'new'
      and order_received_at is null
      and escalated_at is null
      and notification_sent_at is not null
      and notification_sent_at <= now() - (v_threshold_minutes || ' minutes')::interval
      and (scheduled_for is null or scheduled_for <= now() + (v_threshold_minutes || ' minutes')::interval)
    returning id, merchant_id, order_id, notification_sent_at
  loop
    v_count := v_count + 1;

    if v_in_app_enabled then
      begin
        select business_name into v_merchant_name from merchants where id = v_claimed.merchant_id;
        select order_number into v_order_number from orders where id = v_claimed.order_id;
        v_waiting_minutes := greatest(0, floor(extract(epoch from (now() - v_claimed.notification_sent_at)) / 60))::integer;

        for v_ops_user in
          select id from profiles
          where account_status = 'active'
            and (admin_tier is not null or (role::text like 'tolo\_%' and permissions ? 'orders'))
        loop
          insert into notifications (user_id, type, title, body)
          select
            v_ops_user.id,
            t.event_type,
            replace(t.title_template, '{{merchant_name}}', coalesce(v_merchant_name, 'a merchant')),
            replace(replace(replace(replace(t.body_template,
              '{{order_id_short}}', left(v_claimed.id::text, 8)),
              '{{order_number}}', coalesce('TL-' || v_order_number::text, left(v_claimed.id::text, 8))),
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

revoke execute on function escalate_unacknowledged_orders() from public, anon, authenticated;
