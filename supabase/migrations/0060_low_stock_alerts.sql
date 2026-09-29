-- Group 2, item 8: low-stock alerts for merchants. inventory.low_stock_
-- threshold (migration 0005) already existed per variant -- finer-grained
-- than "per product", a superset of what was asked -- but nothing ever
-- read it: no UI exposed it (only test fixtures/mock data ever set it),
-- and nothing notified a merchant when stock actually crossed it.
--
-- Edge-triggered (fires only on the transition from "at/above threshold"
-- to "at/below threshold"), not level-triggered -- a merchant selling
-- several units in a row while already below threshold gets exactly one
-- alert, not one per sale. A merchant creating a product already at or
-- below its threshold from day one does NOT get an initial alert (no
-- AFTER INSERT trigger) -- deliberately out of scope: the real-world case
-- this exists for is stock depleting via sales, not day-one setup, and a
-- merchant who just set the stock number can see it's low themselves.
create or replace function notify_low_stock()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_product_name text;
  v_merchant_owner uuid;
begin
  if new.available_quantity > new.low_stock_threshold or old.available_quantity <= old.low_stock_threshold then
    return new;
  end if;

  select p.name, m.owner_id into v_product_name, v_merchant_owner
  from product_variants pv
  join products p on p.id = pv.product_id
  join merchants m on m.id = p.merchant_id
  where pv.id = new.variant_id;

  if v_merchant_owner is null then
    return new;
  end if;

  insert into notifications (user_id, type, title, body)
  select
    v_merchant_owner,
    t.event_type,
    replace(t.title_template, '{{product_name}}', coalesce(v_product_name, 'A product')),
    replace(replace(t.body_template, '{{product_name}}', coalesce(v_product_name, 'A product')), '{{available_quantity}}', new.available_quantity::text)
  from notification_templates t
  where t.event_type = 'low_stock' and t.channel = 'in_app' and t.language = 'en' and t.enabled;

  return new;
end;
$$;

-- Deliberately NOT revoked from public/anon/authenticated: this is a
-- trigger function (PostgREST already excludes trigger-returning functions
-- from its /rpc/ API, so there's no direct-call exposure to close), and
-- revoking EXECUTE from the DML role that fires a trigger risks breaking
-- the trigger itself -- same caution migration 0035 already documented for
-- every other trigger function in this schema, none of which are revoked.

create trigger inventory_notify_low_stock
  after update on inventory
  for each row
  when (new.available_quantity is distinct from old.available_quantity or new.low_stock_threshold is distinct from old.low_stock_threshold)
  execute function notify_low_stock();

insert into notification_templates (event_type, title_template, body_template) values
  ('low_stock', 'Low stock — {{product_name}}',
   '{{product_name}} is running low: only {{available_quantity}} left. Restock soon to avoid running out.')
on conflict (event_type, channel, language) do nothing;
